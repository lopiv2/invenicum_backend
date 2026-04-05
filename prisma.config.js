// prisma.config.js
require('dotenv').config();
const { defineConfig } = require('@prisma/config');

const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT = '3306', DB_NAME } = process.env;

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: `mysql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`,
  },
});