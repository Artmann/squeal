import { describe, expect, it } from 'vitest'

import { createAstFromSql } from './parser'

describe('createAstFromSql', () => {
  describe('single statements', () => {
    it('parses a simple SELECT statement', () => {
      const result = createAstFromSql('SELECT * FROM users')

      expect(result).toEqual({
        statements: [
          {
            end: 19,
            start: 0,
            text: 'SELECT * FROM users',
            type: 'select'
          }
        ]
      })
    })

    it('parses an INSERT statement', () => {
      const result = createAstFromSql("INSERT INTO users VALUES ('Alice')")

      expect(result).toEqual({
        statements: [
          {
            end: 34,
            start: 0,
            text: "INSERT INTO users VALUES ('Alice')",
            type: 'insert'
          }
        ]
      })
    })

    it('parses an UPDATE statement', () => {
      const result = createAstFromSql("UPDATE users SET name = 'Bob'")

      expect(result).toEqual({
        statements: [
          {
            end: 29,
            start: 0,
            text: "UPDATE users SET name = 'Bob'",
            type: 'update'
          }
        ]
      })
    })

    it('parses a DELETE statement', () => {
      const result = createAstFromSql('DELETE FROM users WHERE id = 1')

      expect(result).toEqual({
        statements: [
          {
            end: 30,
            start: 0,
            text: 'DELETE FROM users WHERE id = 1',
            type: 'delete'
          }
        ]
      })
    })

    it('detects unknown statement type', () => {
      const result = createAstFromSql('CREATE TABLE users (id INT)')

      expect(result).toEqual({
        statements: [
          {
            end: 27,
            start: 0,
            text: 'CREATE TABLE users (id INT)',
            type: 'unknown'
          }
        ]
      })
    })
  })

  describe('multiple statements with semicolons', () => {
    it('splits statements by semicolon', () => {
      const result = createAstFromSql('SELECT 1; SELECT 2')

      expect(result).toEqual({
        statements: [
          { end: 9, start: 0, text: 'SELECT 1;', type: 'select' },
          { end: 18, start: 10, text: 'SELECT 2', type: 'select' }
        ]
      })
    })

    it('handles multiple semicolon-separated statements', () => {
      const result = createAstFromSql(
        'SELECT 1; INSERT INTO t VALUES (1); DELETE FROM t'
      )

      expect(result.statements).toHaveLength(3)
      expect(result.statements[0].type).toEqual('select')
      expect(result.statements[1].type).toEqual('insert')
      expect(result.statements[2].type).toEqual('delete')
    })
  })

  describe('multiple statements without semicolons', () => {
    it('splits statements by newline and keyword', () => {
      const sql = `SELECT * FROM actor

SELECT * FROM film`

      const result = createAstFromSql(sql)

      expect(result.statements).toHaveLength(2)
      expect(result.statements[0]).toEqual({
        end: 19,
        start: 0,
        text: 'SELECT * FROM actor',
        type: 'select'
      })
      expect(result.statements[1]).toEqual({
        end: 39,
        start: 21,
        text: 'SELECT * FROM film',
        type: 'select'
      })
    })

    it('handles mixed statement types without semicolons', () => {
      const sql = `SELECT * FROM users
UPDATE users SET name = 'test'
DELETE FROM users`

      const result = createAstFromSql(sql)

      expect(result.statements).toHaveLength(3)
      expect(result.statements[0].type).toEqual('select')
      expect(result.statements[1].type).toEqual('update')
      expect(result.statements[2].type).toEqual('delete')
    })
  })

  describe('subqueries', () => {
    it('does not split on SELECT inside parentheses', () => {
      const sql = 'SELECT * FROM (SELECT id FROM users)'

      const result = createAstFromSql(sql)

      expect(result).toEqual({
        statements: [
          {
            end: 36,
            start: 0,
            text: 'SELECT * FROM (SELECT id FROM users)',
            type: 'select'
          }
        ]
      })
    })

    it('handles nested subqueries', () => {
      const sql = 'SELECT * FROM (SELECT * FROM (SELECT 1))'

      const result = createAstFromSql(sql)

      expect(result.statements).toHaveLength(1)
      expect(result.statements[0].type).toEqual('select')
    })

    it('handles subquery in WHERE clause', () => {
      const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)'

      const result = createAstFromSql(sql)

      expect(result.statements).toHaveLength(1)
    })
  })

  describe('incomplete statements', () => {
    it('handles incomplete SELECT', () => {
      const result = createAstFromSql('SELECT * FROM')

      expect(result).toEqual({
        statements: [
          {
            end: 13,
            start: 0,
            text: 'SELECT * FROM',
            type: 'select'
          }
        ]
      })
    })

    it('handles just a keyword', () => {
      const result = createAstFromSql('SELECT')

      expect(result).toEqual({
        statements: [
          {
            end: 6,
            start: 0,
            text: 'SELECT',
            type: 'select'
          }
        ]
      })
    })

    it('handles incomplete statement followed by complete one', () => {
      const sql = `SELECT
SELECT * FROM users`

      const result = createAstFromSql(sql)

      expect(result.statements).toHaveLength(2)
      expect(result.statements[0].text).toEqual('SELECT')
      expect(result.statements[1].text).toEqual('SELECT * FROM users')
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      const result = createAstFromSql('')

      expect(result).toEqual({ statements: [] })
    })

    it('returns empty array for whitespace only', () => {
      const result = createAstFromSql('   \n\t  ')

      expect(result).toEqual({ statements: [] })
    })

    it('returns empty array for comment only', () => {
      const result = createAstFromSql('-- just a comment')

      expect(result).toEqual({ statements: [] })
    })

    it('handles comments between statements', () => {
      const sql = `SELECT 1;
-- a comment
SELECT 2`

      const result = createAstFromSql(sql)

      expect(result.statements).toHaveLength(2)
    })

    it('handles statement with leading comment', () => {
      const sql = `-- comment
SELECT * FROM users`

      const result = createAstFromSql(sql)

      expect(result.statements).toHaveLength(1)
      expect(result.statements[0].type).toEqual('select')
    })

    it('handles lowercase keywords', () => {
      const result = createAstFromSql('select * from users')

      expect(result.statements[0].type).toEqual('select')
    })

    it('handles mixed case keywords', () => {
      const result = createAstFromSql('Select * From users')

      expect(result.statements[0].type).toEqual('select')
    })
  })

  describe('position tracking', () => {
    it('tracks correct positions for first statement', () => {
      const sql = 'SELECT * FROM users'
      const result = createAstFromSql(sql)

      expect(result.statements[0].start).toEqual(0)
      expect(result.statements[0].end).toEqual(19)
      expect(
        sql.slice(result.statements[0].start, result.statements[0].end)
      ).toEqual('SELECT * FROM users')
    })

    it('tracks correct positions for multiple statements', () => {
      const sql = 'SELECT 1; SELECT 2'
      const result = createAstFromSql(sql)

      expect(
        sql.slice(result.statements[0].start, result.statements[0].end)
      ).toEqual('SELECT 1;')
      expect(
        sql.slice(result.statements[1].start, result.statements[1].end)
      ).toEqual('SELECT 2')
    })
  })
})
