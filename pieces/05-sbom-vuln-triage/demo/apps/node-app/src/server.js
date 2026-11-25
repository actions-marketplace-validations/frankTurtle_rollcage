// Sample app source. The triage tool greps this tree for evidence; nothing here runs.
const express = require('express');
const _ = require('lodash');
const jwt = require('jsonwebtoken');

const app = express();
const defaults = { currency: 'EUR', pageSize: 20 };

app.get('/orders', (req, res) => {
  const options = _.merge({}, defaults, req.query);
  res.json({ options });
});

app.post('/login', (req, res) => {
  const token = jwt.sign({ sub: req.body.user }, process.env.JWT_SECRET);
  res.json({ token });
});

module.exports = app;
