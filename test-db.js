const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

client.connect()
  .then(() => {
    console.log('Connected to database');
    return client.query('SELECT id, email FROM users WHERE email = $1', ['freshuser@example.com']);
  })
  .then(res => {
    console.log('Users found:', res.rows);
    client.end();
  })
  .catch(err => {
    console.error('Database error:', err);
    client.end();
  });