require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");
const { processOneOrder } = require("./db/insert");
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit:"50mb"}));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

async function getOrderByCode(code) {
  const resp = await axios.get(`${process.env.PIED_API_URL}/pied`, {
    params: { code },
    headers: {
      Authorization: `Bearer ${process.env.PIED_API_KEY}`,
    },
    maxBodyLength: Infinity,
    timeout: 120000,
  });
  return resp.data;
}

const COLLECT_WINDOW_MS = 10000;
const PER_ITEM_DELAY_MS = 15000;
const pendingCodes = new Set();
let collectTimer = null;

const queue = [];
let workerRunning = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function scheduleFlush() {
  if (collectTimer) clearTimeout(collectTimer);

  collectTimer = setTimeout(() => {
    collectTimer = null;

    const batch = Array.from(pendingCodes);
    pendingCodes.clear();

    if (batch.length === 0) return;

    console.log(`[BATCH] flush: ${batch.length} codes -> fila`);

    for (const code of batch) {
      // evita repetir na fila
      if (!queue.includes(code)) queue.push(code);
    }

    startWorker();
  }, COLLECT_WINDOW_MS);
}

function startWorker() {
  if (workerRunning) return;
  workerRunning = true;
  runWorker().finally(() => {
    workerRunning = false;
    // se entrou coisa nova enquanto rodava
    if (queue.length > 0) startWorker();
  });
}

async function runWorker() {
  while (queue.length > 0) {
    const code = queue.shift();
    const startTs = Date.now();

    console.log(`[WORKER] start code=${code} queue_left=${queue.length}`);

    let order;
    try {
      order = await getOrderByCode(code);
      console.log(`[WORKER] fetched /pied code=${code}`);
    } catch (e) {
      const status = e?.response?.status || 500;
      const data = e?.response?.data || null;
      console.log(`[WORKER][Pied][ERR] code=${code} status=${status}`, data || (e?.message || e));

      await sleep(PER_ITEM_DELAY_MS);
      continue;
    }
    const order2 = order?.data?.items?.[0];

    if (
      order2.requestStatus === "Pedido Entregue" &&
      order2.invoice?.serviceToAddInvoiceValue &&
      !order2.customData?.some(item => item.key === 'repasse')
    ) {
      console.log(`Movendo o item: ${order2.code} de status: ${order2.requestStatus} para status: REPASSE`)
      // PEDIDO ENTREGUE / REPASSE
      let codeRepasse = order2.code;
      let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `${process.env.PIED_API_URL}/repasse?code=${codeRepasse}`,
        headers: {
          'Authorization': `Bearer ${process.env.PIED_API_KEY}`
        }
      };

      axios.request(config)
        .then((response) => {
          console.log(JSON.stringify(response.data));
        })
        .catch((error) => {
          console.log(error);
        });
      console.log(`💀 | 💀  CODE: ${codeRepasse} movido para repasse! 💀 | 💀  `)

    } else if (
      order2.requestStatus === "Pedido Entregue" &&
      (
        !order2.invoice?.serviceToAddInvoiceValue ||
        order2.customData?.some(item => item.key === 'repasse')
      )
    ) {
      console.log(`O ${order2.code} não tem repasse, avaliando filtro para finalizado!`);
      const required = new Set(['infull', 'nf', 'ontime', 'transportadora']);
      const keys = new Set(
        (order2.customData || []).map(d => d.key)
      );
      const hasAllRequired = [...required].every(k => keys.has(k));
      if (!hasAllRequired) {
        console.log(`order ${order2.code} nao passou no filtro para mover para finalizado`);
      } else {
        const codeFinalizado = order2.code;

        let config = {
          method: 'get',
          maxBodyLength: Infinity,
          url: `${process.env.PIED_API_URL}/finish?code=${codeFinalizado}`,
          headers: {
            'Authorization': `Bearer ${process.env.PIED_API_KEY}`
          }
        };

        axios.request(config)
          .then((response) => {
            console.log(JSON.stringify(response.data));
            console.log(` 🧿| 👁️ |🧿  CODE: ${codeFinalizado} movido para finalizado! 🧿| 👁️ |🧿 `);
          })
          .catch((error) => {
            console.log(error);
          });
      }
    }
    else {
      console.log(` 🐵🐵| |🐒🐒  CODE:${order2.code} FLUXO COMUM  🦍🦍| |🙈🙈`)
    }
    const client = await pool.connect();
    console.log(`[DB] conexão adquirida para code=${code}`);
    try {
      await client.query("BEGIN");
      console.log(`[DB][TX] BEGIN code=${code}`);
      console.log(`[DB][INSERT] start processOneOrder code=${code}`);
      await processOneOrder(client, order);
      console.log(`[DB][INSERT] end processOneOrder code=${code}`);
      await client.query("COMMIT");
      console.log(`[DB][TX] COMMIT code=${code}`);
      const elapsed = Date.now() - startTs;
      console.log(`[WORKER][OK] code=${code} time=${elapsed}ms`);
    } catch (e) {
      console.log(`[DB][ERR] code=${code}`, e?.message || e);
      try {
        await client.query("ROLLBACK");
        console.log(`[DB][TX] ROLLBACK code=${code}`);
      } catch (rbErr) {
        console.log(`[DB][TX][ERR] rollback falhou code=${code}`, rbErr);
      }
    } finally {
      client.release();
      console.log(`[DB] conexão liberada code=${code}`);
    }

    await sleep(PER_ITEM_DELAY_MS);
  }

  console.log("[WORKER] fila vazia");
}

app.post("/order", (req, res) => {
  console.log("[WEBHOOK] /order chamado");

  const authHeader = req.get("authorization");
  if (!authHeader) {
    console.log("[WEBHOOK][AUTH] header ausente");
    return res.status(401).send("Não foi encontrado o header Authorization");
  }

  if (authHeader !== `Bearer ${process.env.WEBHOOK_AUTH_TOKEN}`) {
    console.log("[WEBHOOK][AUTH] token inválido:", authHeader);
    return res.status(403).send("Token inválido");
  }

  const payload = req.body;
  const it = payload && payload.data ? payload.data : null;

  if (!it || !it.code) {
    console.log("[WEBHOOK][ERR] payload inválido");
    return res.status(400).send("Payload inválido: faltando data/code");
  }

  // 1) Coleta o code (uniq)
  const before = pendingCodes.size;
  pendingCodes.add(it.code);
  const after = pendingCodes.size;

  console.log(
    `[WEBHOOK] coletado code=${it.code} uniq=${after} (added=${after > before})`
  );

  scheduleFlush();

  return res.status(200).json({ ok: true, received: true, code: it.code });
});

module.exports = app;