const mongoose = require('mongoose');

function toSnakeCase(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function transformValue(val) {
  if (val instanceof mongoose.Types.ObjectId) return val.toString();
  if (val instanceof Date) return val.toISOString();
  if (Buffer.isBuffer(val)) return val.toString('base64');
  return val;
}

function transformData(data) {
  if (data === null || data === undefined) return data;
  if (data instanceof mongoose.Types.ObjectId) return data.toString();
  if (Array.isArray(data)) return data.map(transformData);
  if (typeof data !== 'object') return data;
  if (data instanceof Date) return data.toISOString();

  const result = {};
  for (const [key, val] of Object.entries(data)) {
    let newKey = key;
    if (key === '_id') {
      newKey = 'id';
    } else if (key === '__v') {
      continue;
    } else if (/^[a-z][a-zA-Z]+$/.test(key)) {
      newKey = toSnakeCase(key);
    }

    if (val instanceof mongoose.Types.ObjectId) {
      result[newKey] = val.toString();
    } else if (Array.isArray(val)) {
      result[newKey] = val.map(transformData);
    } else if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
      result[newKey] = transformData(val);
    } else {
      result[newKey] = transformValue(val);
    }
  }
  return result;
}

const success = (res, data, code = 200) => {
  return res.status(code).json({ success: true, data: transformData(data) });
};

const fail = (res, message, code = 400, errors = null) => {
  const payload = { success: false, message };
  if (errors) payload.errors = errors;
  return res.status(code).json(payload);
};

const getInput = (req) => {
  return req.body;
};

module.exports = { success, fail, getInput, transformData };
