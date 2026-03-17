const express = require('express');
const path = require('path');
const app = express();
const webhook = require('./routes/webhook')

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));



app.use(webhook)
app.get('/help', (req, res) => {
  res.send('teste');
});


app.listen(3000, '0.0.0.0', () => console.log('Backend rodando em 0.0.0.0:3000'));
