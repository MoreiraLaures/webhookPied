# webhookPied

Serviço Node.js que atua como **proxy para a API da Pied** e como **endpoint de webhook** para automações internas. Ele recebe notificações de pedidos, consulta dados na Pied, aplica regras de negócio (repasse / finalizado) e persiste tudo em um banco PostgreSQL.

---

## Visão geral

```
Automação externa
      |
      | POST /order  (Bearer token)
      v
  webhookPied  (porta 3000)
      |
      |-- GET /pied?code=...  -->  API Pied  (Bearer key)
      |-- GET /repasse?code=...  -->  API Pied
      |-- GET /finish?code=...   -->  API Pied
      |
      v
  PostgreSQL  (schema Geral)
```

---

## Fluxo de funcionamento

### 1. Recebimento do webhook — `POST /order`

Uma automação externa envia um `POST /order` com o payload:

```json
{
  "data": { "code": "PED-12345" }
}
```

O header `Authorization: Bearer <WEBHOOK_AUTH_TOKEN>` é obrigatório.

O serviço coleta os códigos recebidos em uma janela de **10 segundos** (`COLLECT_WINDOW_MS`) para deduplicar chamadas em rajada, depois enfileira cada código único para processamento.

### 2. Processamento assíncrono — worker

Para cada código na fila, com intervalo de **15 segundos** entre itens (`PER_ITEM_DELAY_MS`):

1. Consulta `GET /pied?code=<code>` na API da Pied.
2. Avalia o status do pedido e aplica uma das três regras:

| Condição | Ação |
|---|---|
| `Pedido Entregue` + tem `serviceToAddInvoiceValue` + **sem** `customData.repasse` | Chama `GET /repasse?code=` → move pedido para **Repasse** |
| `Pedido Entregue` + sem repasse devido (já tem repasse ou sem valor) + tem todos os campos obrigatórios (`infull`, `nf`, `ontime`, `transportadora`) | Chama `GET /finish?code=` → move pedido para **Finalizado** |
| Qualquer outro status | Segue fluxo comum (só persiste no banco) |

3. Persiste o pedido completo no PostgreSQL (upsert na tabela principal + delete/insert nas tabelas filhas).

### 3. Proxy para a API Pied — `apiPied.js`

O módulo `routes/apiPied.js` exporta a função `getPied(code)`, utilizada por outras automações internas para consultar pedidos na Pied sem expor a chave de API diretamente. Inclui timeout de 120s, desabilitação de proxy de sistema e log detalhado de erros Axios.

---

## Estrutura de arquivos

```
.
├── server.js               # Entry point — sobe Express na porta 3000
├── ecosystem.config.js     # Configuração PM2
├── routes/
│   ├── webhook.js          # Lógica do endpoint POST /order e worker
│   ├── apiPied.js          # Função getPied() — proxy para API Pied
│   └── db/
│       ├── db.js           # Pool de conexão PostgreSQL
│       └── insert.js       # Persistência dos pedidos (upsert/insert)
├── .env                    # Variáveis de ambiente (não versionado)
└── .env_example            # Exemplo das variáveis necessárias
```

---

## Configuração

Copie `.env_example` para `.env` e preencha:

```env
# Banco de Dados
DB_HOST=
DB_PORT=5432
DB_USER=
DB_PASS=
DB_NAME=

# API Pied
PIED_API_URL=
PIED_API_KEY=

# Autenticação do Webhook
WEBHOOK_AUTH_TOKEN=
```

---

## Execução

### Direto

```bash
npm install
npm start
```

### Com PM2

```bash
pm2 start ecosystem.config.js
pm2 logs webhookPied
```

---

## Endpoint disponível

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/order` | Recebe notificação de pedido da automação externa |
| `GET` | `/help` | Health check básico |

### Autenticação

Todas as chamadas a `POST /order` devem incluir:

```
Authorization: Bearer <WEBHOOK_AUTH_TOKEN>
```

### Payload esperado

```json
{
  "data": {
    "code": "PED-12345"
  }
}
```

---

## Tabelas PostgreSQL (schema `Geral`)

O serviço realiza upsert/insert nas seguintes tabelas a cada pedido processado:

- `orders` — dados gerais do pedido
- `orders_status` — status do pedido
- `orders_custom_field` — campos customizados (infull, ontime, transportadora, nf, etc.)
- `orders_products` — produtos
- `orders_company` / `orders_company_main_contact` / `orders_company_address` — dados da empresa
- `orders_date` — datas relevantes
- `orders_simplepayment` / `orders_detail_payment` — pagamento
- `orders_freight` — frete e endereço de entrega
- `orders_invoice` / `orders_invoice_freight` — nota fiscal
- `orders_responsible` / `orders_added_by` — responsáveis
- `orders_structure` / `orders_structures_arrangements` — estruturas do projeto
- `orders_files` / `orders_files_payment` — arquivos anexados
- `orders_miscellaneous` — dados avulsos
