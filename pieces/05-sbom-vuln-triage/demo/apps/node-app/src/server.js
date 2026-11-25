// Sample app source. The triage tool greps this tree for evidence; nothing here runs.
import express from 'express';
import _ from 'lodash';
import jwt from 'jsonwebtoken';

const app = express();
const defaults = { currency: 'EUR', pageSize: 20 };

app.get('/orders', (req, res) => {
  const options = _.merge({}, defaults, req.query);
  res.json({ options });
});

app.post('/login', (req, res) => {
  const token = jwt.sign({ sub: req.body.user }, loadSecret());
  res.json({ token });
});

function loadSecret() {
  return '';
}

export default app;
