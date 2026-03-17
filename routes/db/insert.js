const { query } = require('./db');
const express = require("express");




function upsertSql(table, cols, conflictCols) {
  const setCols = [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (conflictCols.indexOf(c) === -1) setCols.push(c);
  }

  const insertColsArr = [];
  for (let i = 0; i < cols.length; i++) insertColsArr.push('"' + cols[i] + '"');
  const insertCols = insertColsArr.join(", ");

  const valsArr = [];
  for (let i = 0; i < cols.length; i++) valsArr.push("$" + (i + 1));
  const vals = valsArr.join(", ");

  const conflictArr = [];
  for (let i = 0; i < conflictCols.length; i++) conflictArr.push('"' + conflictCols[i] + '"');
  const conflict = conflictArr.join(", ");

  const setArr = [];
  for (let i = 0; i < setCols.length; i++) {
    const c = setCols[i];
    setArr.push('"' + c + '"=EXCLUDED."' + c + '"');
  }
  const set = setArr.join(", ");

  return "INSERT INTO " + table + " (" + insertCols + ") VALUES (" + vals + ") ON CONFLICT (" + conflict + ") DO UPDATE SET " + set;
}

async function insertMany(client, table, cols, rows) {
  if (!rows || rows.length === 0) return;

  const values = [];
  const chunksArr = [];

  for (let ri = 0; ri < rows.length; ri++) {
    const phArr = [];
    for (let ci = 0; ci < cols.length; ci++) {
      phArr.push("$" + (ri * cols.length + ci + 1));
    }

    const row = rows[ri];
    for (let ci = 0; ci < row.length; ci++) values.push(row[ci]);

    chunksArr.push("(" + phArr.join(", ") + ")");
  }

  const colsArr = [];
  for (let ci = 0; ci < cols.length; ci++) colsArr.push('"' + cols[ci] + '"');

  const q = "INSERT INTO " + table + " (" + colsArr.join(", ") + ") VALUES " + chunksArr.join(", ");
  await client.query(q, values);
}

function iterStructs(it) {
  const s = it && it.structure;

  if (s && typeof s === "object" && !Array.isArray(s)) return [s];

  if (Array.isArray(s)) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] && typeof s[i] === "object" && !Array.isArray(s[i])) out.push(s[i]);
    }
    return out;
  }

  return [];
}

// ... (resto do arquivo igual)

async function processOneOrder(client, it) {
  const code = it && it.code;
  if (!code) return;

  const ordersCols = ["code", "id", "name", "kind", "total_power"];
  const ordersVals = [code, it.id || null, it.name || null, it.kind || null, it.totalPower || null];
  await client.query(upsertSql('"Geral".orders', ordersCols, ["code"]), ordersVals);

  const childTables = [
    '"Geral".orders_miscellaneous',
    '"Geral".orders_status',
    '"Geral".orders_custom_field',
    '"Geral".orders_products',
    '"Geral".orders_company',
    '"Geral".orders_company_main_contact',
    '"Geral".orders_company_address',
    '"Geral".orders_date',
    '"Geral".orders_simplepayment',
    '"Geral".orders_detail_payment',
    '"Geral".orders_freight',
    '"Geral".orders_invoice',
    '"Geral".orders_invoice_freight',
    '"Geral".orders_responsible',
    '"Geral".orders_added_by',
    '"Geral".orders_structure',
    '"Geral".orders_files',
    '"Geral".orders_structures_arrangements',
    '"Geral".orders_files_payment'
  ];

  for (let i = 0; i < childTables.length; i++) {
    await client.query("DELETE FROM " + childTables[i] + " WHERE code = $1", [code]);
  }

  await insertMany(client, '"Geral".orders_miscellaneous', ["code", "api_sent", "files"], [[code, it.apiSent || null, it.files || null]]);

  await insertMany(
    client,
    '"Geral".orders_status',
    ["code", "stock_status", "dealstatus", "requeststatus", "notes"],
    [[code, it.stockStatus || null, it.dealStatus || null, it.requestStatus || null, it.notes || null]]
  );

  const cd = Array.isArray(it.customData) ? it.customData : [];
  function getCd(k) {
    for (let i = 0; i < cd.length; i++) {
      if (cd[i] && cd[i].key === k) return cd[i].value;
    }
    return null;
  }

  await insertMany(
    client,
    '"Geral".orders_custom_field',
    ["code", "infull", "ontime", "transportadora", "notafiscal", "frete_faturado", "repasse_time"],
    [[code, getCd("infull"), getCd("ontime"), getCd("transportadora"), getCd("nf"), getCd("frefat"), getCd("repasse")]]
  );

  const prows = [];
  const products = Array.isArray(it.products) ? it.products : [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p || typeof p !== "object") continue;
    prows.push([code, p.productCode || null, p.name || null, p.type || null, p.quantity || null, p.singlePrice || null, p.totalPrice || null]);
  }
  await insertMany(client, '"Geral".orders_products', ["code", "product_code", "name", "type", "quantity", "single_price", "total_price"], prows);

  const comp = it.company && typeof it.company === "object" ? it.company : {};
  await insertMany(
    client,
    '"Geral".orders_company',
    ["code", "company_name", "fantasy_name", "cpf", "cnpj"],
    [[code, comp.companyName || null, comp.fantasyName || null, comp.cpf || null, comp.cnpj || null]]
  );

  const mc = comp.mainContact && typeof comp.mainContact === "object" ? comp.mainContact : {};
  await insertMany(
    client,
    '"Geral".orders_company_main_contact',
    ["code", "main_contact_name", "main_contact_surname", "main_contact_cellphone", "main_contact_email"],
    [[code, mc.name || null, mc.surname || null, mc.cellphone || null, mc.email || null]]
  );

  const addrC = comp.address && typeof comp.address === "object" ? comp.address : {};
  await insertMany(
    client,
    '"Geral".orders_company_address',
    ["code", "address_cep", "address_patio", "address_neighborhood", "address_city", "address_state", "address_number"],
    [[code, addrC.CEP || null, addrC.patio || null, addrC.neighborhood || null, addrC.city || null, addrC.state || null, addrC.number || null]]
  );

  await insertMany(
    client,
    '"Geral".orders_date',
    ["code", "billingdate", "apisentupdated", "budgetcreated", "ordercreated"],
    [[code, it.billingDate || null, it.apiSentUpdated || null, it.budgetCreated || null, it.orderCreated || null]]
  );

  await insertMany(
    client,
    '"Geral".orders_simplepayment',
    ["code", "discount", "surcharge", "difference_with_payment_condition_applied", "originalvalue", "totalvalue", "finalvalue", "profitmargin"],
    [[code, it.discount || null, it.surcharge || null, it.differenceWithPaymentConditionApplied || null, it.originalValue || null, it.totalValue || null, it.finalValue || null, it.profitMargin || null]]
  );

  const pay = it.payment && typeof it.payment === "object" ? it.payment : {};
  const cond = pay.condition && typeof pay.condition === "object" ? pay.condition : {};
  await insertMany(
    client,
    '"Geral".orders_detail_payment',
    ["code", "payment_description", "payment_type", "conditionid", "condition_name", "condition_type", "condition_modifier_type", "condition_value", "payment_status"],
    [[code, pay.description || null, pay.type || null, cond._id || null, cond.name || null, cond.conditionType || null, cond.modifierType || null, cond.value || null, pay.status || null]]
  );

  const fr = it.freight && typeof it.freight === "object" ? it.freight : {};
  const addrF = fr.address && typeof fr.address === "object" ? fr.address : {};
  await insertMany(
    client,
    '"Geral".orders_freight',
    ["code", "address_state", "address_city", "type", "address_number", "time_restriction", "truckpossible", "address_patio_type", "zone_type", "address_patioformatted", "address_cep", "address_patio", "address_neighborhood", "freight_price"],
    [[code, addrF.state || null, addrF.city || null, fr.type || null, addrF.number || null, fr.timeRestriction || null, fr.truckPossible || null, addrF.patioType || null, fr.zoneType || null, fr.patioFormatted || null, addrF.CEP || null, addrF.patio || null, addrF.neighborhood || null, fr.price || null]]
  );

  const inv = it.invoice && typeof it.invoice === "object" ? it.invoice : {};
  await insertMany(
    client,
    '"Geral".orders_invoice',
    ["code", "email", "original_invoice_value", "razao_social", "nome_fantasia", "tem_inscricao_estadual", "cnpj", "cpf", "telefone", "serviceToAddInvoiceValue", "requestedinvoicevalue"],
    [[code, inv.email || null, inv.originalInvoiceValue || null, inv.razaoSocial || null, inv.nomeFantasia || null, inv.temInscricaoEstadual || null, inv.cnpj || null, inv.cpf || null, inv.telephone || null, inv.serviceToAddInvoiceValue || null, inv.requestedInvoiceValue || null]]
  );

  const addrI = inv.address && typeof inv.address === "object" ? inv.address : {};
  await insertMany(
    client,
    '"Geral".orders_invoice_freight',
    ["code", "addres_patio_type", "addres_patio_formatted", "address_cep", "address_patio", "address_neighborhood", "address_city", "address_state", "address_number", "address_complement"],
    [[code, addrI.patioType || null, addrI.patioFormatted || null, addrI.CEP || null, addrI.patio || null, addrI.neighborhood || null, addrI.city || null, addrI.state || null, addrI.number || null, addrI.complement || null]]
  );

  const resp = it.responsible && typeof it.responsible === "object" ? it.responsible : {};
  await insertMany(client, '"Geral".orders_responsible', ["code", "name", "surname", "cellphone", "email"], [[code, resp.name || null, resp.surname || null, resp.cellphone || null, resp.email || null]]);

  const addby = it.addedBy && typeof it.addedBy === "object" ? it.addedBy : {};
  await insertMany(client, '"Geral".orders_added_by', ["code", "name", "surname", "email"], [[code, addby.name || null, addby.surname || null, addby.email || null]]);

  const structs = iterStructs(it);
  const srows = [];
  for (let i = 0; i < structs.length; i++) srows.push([code, structs[i].kind || null]);
  await insertMany(client, '"Geral".orders_structure', ["code", "kind"], srows);

  const sarows = [];
  for (let i = 0; i < structs.length; i++) {
    const arr = Array.isArray(structs[i].arrangements) ? structs[i].arrangements : [];
    for (let j = 0; j < arr.length; j++) {
      const a = arr[j];
      if (!a || typeof a !== "object") continue;
      sarows.push([code, a.linesAmount || null, a.modulesByLine || null, a.orientation || null]);
    }
  }
  await insertMany(client, '"Geral".orders_structures_arrangements', ["code", "arrangements_linesamount", "modules_by_line", "orientation"], sarows);

  const files = Array.isArray(it.files) ? it.files : [];
  const frows = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f || typeof f !== "object") continue;
    frows.push([code, f.path || null, f.originalName || null]);
  }
  await insertMany(client, '"Geral".orders_files', ["code", "path", "name"], frows);

  const payFiles = pay && Array.isArray(pay.files) ? pay.files : [];
  const pfrows = [];
  for (let i = 0; i < payFiles.length; i++) {
    const f = payFiles[i];
    if (!f || typeof f !== "object") continue;
    pfrows.push([code, f.path || null, f.originalName || null]);
  }
  await insertMany(client, '"Geral".orders_files_payment', ["code", "path", "original_name"], pfrows);
}

module.exports = {processOneOrder};
