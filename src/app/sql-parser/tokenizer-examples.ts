import { tokenize } from './tokenizer'

const sql = `SELECT * FROM actor`

console.log('SQL Query: ' + sql)

const tokens = tokenize(sql)

console.log(tokens)
