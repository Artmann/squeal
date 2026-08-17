import { describe, expect, it } from 'vitest'

import { tokenize } from './tokenizer'

describe('tokenize', () => {
  describe('keywords', () => {
    it('recognizes SQL keywords', () => {
      const tokens = tokenize('SELECT FROM WHERE')

      expect(tokens).toEqual([
        { end: 6, start: 0, type: 'keyword', value: 'SELECT' },
        { end: 7, start: 6, type: 'whitespace', value: ' ' },
        { end: 11, start: 7, type: 'keyword', value: 'FROM' },
        { end: 12, start: 11, type: 'whitespace', value: ' ' },
        { end: 17, start: 12, type: 'keyword', value: 'WHERE' }
      ])
    })

    it('recognizes keywords case-insensitively', () => {
      const tokens = tokenize('select FROM Where')

      expect(tokens).toEqual([
        { end: 6, start: 0, type: 'keyword', value: 'select' },
        { end: 7, start: 6, type: 'whitespace', value: ' ' },
        { end: 11, start: 7, type: 'keyword', value: 'FROM' },
        { end: 12, start: 11, type: 'whitespace', value: ' ' },
        { end: 17, start: 12, type: 'keyword', value: 'Where' }
      ])
    })

    it('recognizes all supported keywords', () => {
      const keywords = [
        'AND',
        'AS',
        'ASC',
        'BETWEEN',
        'BY',
        'CASE',
        'DELETE',
        'DESC',
        'DISTINCT',
        'ELSE',
        'END',
        'FALSE',
        'FROM',
        'GROUP',
        'HAVING',
        'IN',
        'INSERT',
        'INTO',
        'IS',
        'JOIN',
        'LEFT',
        'LIKE',
        'LIMIT',
        'NOT',
        'NULL',
        'OFFSET',
        'ON',
        'OR',
        'ORDER',
        'RIGHT',
        'SELECT',
        'SET',
        'THEN',
        'TRUE',
        'UPDATE',
        'VALUES',
        'WHEN',
        'WHERE'
      ]

      for (const keyword of keywords) {
        const tokens = tokenize(keyword)
        expect(tokens[0].type).toEqual('keyword')
      }
    })
  })

  describe('identifiers', () => {
    it('recognizes simple identifiers', () => {
      const tokens = tokenize('users')

      expect(tokens).toEqual([
        { end: 5, start: 0, type: 'identifier', value: 'users' }
      ])
    })

    it('recognizes identifiers with underscores', () => {
      const tokens = tokenize('user_name')

      expect(tokens).toEqual([
        { end: 9, start: 0, type: 'identifier', value: 'user_name' }
      ])
    })

    it('recognizes identifiers starting with underscore', () => {
      const tokens = tokenize('_private')

      expect(tokens).toEqual([
        { end: 8, start: 0, type: 'identifier', value: '_private' }
      ])
    })

    it('recognizes identifiers with numbers', () => {
      const tokens = tokenize('table1')

      expect(tokens).toEqual([
        { end: 6, start: 0, type: 'identifier', value: 'table1' }
      ])
    })

    it('recognizes double-quoted identifiers', () => {
      const tokens = tokenize('"column name"')

      expect(tokens).toEqual([
        { end: 13, start: 0, type: 'identifier', value: '"column name"' }
      ])
    })

    it('recognizes backtick-quoted identifiers', () => {
      const tokens = tokenize('`table`')

      expect(tokens).toEqual([
        { end: 7, start: 0, type: 'identifier', value: '`table`' }
      ])
    })
  })

  describe('numbers', () => {
    it('recognizes integers', () => {
      const tokens = tokenize('42')

      expect(tokens).toEqual([
        { end: 2, start: 0, type: 'number', value: '42' }
      ])
    })

    it('recognizes decimal numbers', () => {
      const tokens = tokenize('3.14')

      expect(tokens).toEqual([
        { end: 4, start: 0, type: 'number', value: '3.14' }
      ])
    })

    it('recognizes numbers with leading decimal', () => {
      const tokens = tokenize('.5')

      expect(tokens).toEqual([
        { end: 2, start: 0, type: 'number', value: '.5' }
      ])
    })

    it('recognizes zero', () => {
      const tokens = tokenize('0')

      expect(tokens).toEqual([{ end: 1, start: 0, type: 'number', value: '0' }])
    })
  })

  describe('strings', () => {
    it('recognizes simple strings', () => {
      const tokens = tokenize("'hello'")

      expect(tokens).toEqual([
        { end: 7, start: 0, type: 'string', value: "'hello'" }
      ])
    })

    it('recognizes empty strings', () => {
      const tokens = tokenize("''")

      expect(tokens).toEqual([
        { end: 2, start: 0, type: 'string', value: "''" }
      ])
    })

    it('recognizes strings with escaped quotes', () => {
      const tokens = tokenize("'it''s'")

      expect(tokens).toEqual([
        { end: 7, start: 0, type: 'string', value: "'it''s'" }
      ])
    })

    it('recognizes strings with multiple escaped quotes', () => {
      const tokens = tokenize("'a''b''c'")

      expect(tokens).toEqual([
        { end: 9, start: 0, type: 'string', value: "'a''b''c'" }
      ])
    })

    it('recognizes strings with spaces', () => {
      const tokens = tokenize("'hello world'")

      expect(tokens).toEqual([
        { end: 13, start: 0, type: 'string', value: "'hello world'" }
      ])
    })
  })

  describe('comments', () => {
    it('recognizes single-line comments', () => {
      const tokens = tokenize('-- this is a comment')

      expect(tokens).toEqual([
        { end: 20, start: 0, type: 'comment', value: '-- this is a comment' }
      ])
    })

    it('recognizes single-line comments before newline', () => {
      const tokens = tokenize('-- comment\nSELECT')

      expect(tokens).toEqual([
        { end: 10, start: 0, type: 'comment', value: '-- comment' },
        { end: 11, start: 10, type: 'whitespace', value: '\n' },
        { end: 17, start: 11, type: 'keyword', value: 'SELECT' }
      ])
    })

    it('recognizes block comments', () => {
      const tokens = tokenize('/* comment */')

      expect(tokens).toEqual([
        { end: 13, start: 0, type: 'comment', value: '/* comment */' }
      ])
    })

    it('recognizes multi-line block comments', () => {
      const tokens = tokenize('/* line1\nline2 */')

      expect(tokens).toEqual([
        { end: 17, start: 0, type: 'comment', value: '/* line1\nline2 */' }
      ])
    })
  })

  describe('operators', () => {
    it('recognizes single-character operators', () => {
      const operators = ['=', '<', '>', '+', '-', '*', '/', '%']

      for (const operator of operators) {
        const tokens = tokenize(operator)
        expect(tokens).toEqual([
          { end: 1, start: 0, type: 'operator', value: operator }
        ])
      }
    })

    it('recognizes multi-character operators', () => {
      const operators = ['<>', '<=', '>=', '!=', '||']

      for (const operator of operators) {
        const tokens = tokenize(operator)
        expect(tokens).toEqual([
          { end: 2, start: 0, type: 'operator', value: operator }
        ])
      }
    })

    it('recognizes less than or equal', () => {
      const tokens = tokenize('<=')

      expect(tokens).toEqual([
        { end: 2, start: 0, type: 'operator', value: '<=' }
      ])
    })

    it('recognizes not equal variations', () => {
      expect(tokenize('<>')[0]).toEqual({
        end: 2,
        start: 0,
        type: 'operator',
        value: '<>'
      })

      expect(tokenize('!=')[0]).toEqual({
        end: 2,
        start: 0,
        type: 'operator',
        value: '!='
      })
    })
  })

  describe('punctuation', () => {
    it('recognizes parentheses', () => {
      const tokens = tokenize('()')

      expect(tokens).toEqual([
        { end: 1, start: 0, type: 'punctuation', value: '(' },
        { end: 2, start: 1, type: 'punctuation', value: ')' }
      ])
    })

    it('recognizes comma', () => {
      const tokens = tokenize(',')

      expect(tokens).toEqual([
        { end: 1, start: 0, type: 'punctuation', value: ',' }
      ])
    })

    it('recognizes semicolon', () => {
      const tokens = tokenize(';')

      expect(tokens).toEqual([
        { end: 1, start: 0, type: 'punctuation', value: ';' }
      ])
    })

    it('recognizes dot', () => {
      const tokens = tokenize('.')

      expect(tokens).toEqual([
        { end: 1, start: 0, type: 'punctuation', value: '.' }
      ])
    })
  })

  describe('whitespace', () => {
    it('recognizes spaces', () => {
      const tokens = tokenize('   ')

      expect(tokens).toEqual([
        { end: 3, start: 0, type: 'whitespace', value: '   ' }
      ])
    })

    it('recognizes tabs', () => {
      const tokens = tokenize('\t')

      expect(tokens).toEqual([
        { end: 1, start: 0, type: 'whitespace', value: '\t' }
      ])
    })

    it('recognizes newlines', () => {
      const tokens = tokenize('\n')

      expect(tokens).toEqual([
        { end: 1, start: 0, type: 'whitespace', value: '\n' }
      ])
    })

    it('groups consecutive whitespace', () => {
      const tokens = tokenize(' \t\n ')

      expect(tokens).toEqual([
        { end: 4, start: 0, type: 'whitespace', value: ' \t\n ' }
      ])
    })
  })

  describe('full SQL statements', () => {
    it('tokenizes a simple SELECT query', () => {
      const tokens = tokenize('SELECT * FROM users')

      expect(tokens).toEqual([
        { end: 6, start: 0, type: 'keyword', value: 'SELECT' },
        { end: 7, start: 6, type: 'whitespace', value: ' ' },
        { end: 8, start: 7, type: 'operator', value: '*' },
        { end: 9, start: 8, type: 'whitespace', value: ' ' },
        { end: 13, start: 9, type: 'keyword', value: 'FROM' },
        { end: 14, start: 13, type: 'whitespace', value: ' ' },
        { end: 19, start: 14, type: 'identifier', value: 'users' }
      ])
    })

    it('tokenizes a SELECT with WHERE clause', () => {
      const tokens = tokenize("SELECT id FROM users WHERE name = 'John'")

      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual([
        'SELECT',
        'id',
        'FROM',
        'users',
        'WHERE',
        'name',
        '=',
        "'John'"
      ])
    })

    it('tokenizes a SELECT with JOIN', () => {
      const sql =
        'SELECT u.name FROM users u LEFT JOIN orders o ON u.id = o.user_id'
      const tokens = tokenize(sql)

      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual([
        'SELECT',
        'u',
        '.',
        'name',
        'FROM',
        'users',
        'u',
        'LEFT',
        'JOIN',
        'orders',
        'o',
        'ON',
        'u',
        '.',
        'id',
        '=',
        'o',
        '.',
        'user_id'
      ])
    })

    it('tokenizes an INSERT statement', () => {
      const sql = "INSERT INTO users (name, age) VALUES ('Alice', 30)"
      const tokens = tokenize(sql)

      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual([
        'INSERT',
        'INTO',
        'users',
        '(',
        'name',
        ',',
        'age',
        ')',
        'VALUES',
        '(',
        "'Alice'",
        ',',
        '30',
        ')'
      ])
    })

    it('tokenizes an UPDATE statement', () => {
      const sql = "UPDATE users SET name = 'Bob' WHERE id = 1"
      const tokens = tokenize(sql)

      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual([
        'UPDATE',
        'users',
        'SET',
        'name',
        '=',
        "'Bob'",
        'WHERE',
        'id',
        '=',
        '1'
      ])
    })

    it('tokenizes a DELETE statement', () => {
      const sql = 'DELETE FROM users WHERE id = 1'
      const tokens = tokenize(sql)

      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual([
        'DELETE',
        'FROM',
        'users',
        'WHERE',
        'id',
        '=',
        '1'
      ])
    })
  })

  describe('token positions', () => {
    it('tracks correct positions for sequential tokens', () => {
      const tokens = tokenize('a b')

      expect(tokens[0]).toEqual({
        end: 1,
        start: 0,
        type: 'identifier',
        value: 'a'
      })
      expect(tokens[1]).toEqual({
        end: 2,
        start: 1,
        type: 'whitespace',
        value: ' '
      })
      expect(tokens[2]).toEqual({
        end: 3,
        start: 2,
        type: 'identifier',
        value: 'b'
      })
    })

    // The three fields of a token have to agree: `value` is what the slice
    // says, and `end` is where the slice stopped. Nothing downstream should have
    // to defend against a token pointing past its own input, and `tokenize`
    // advances by `end`, so a token has to consume at least one character.
    it('positions match the original string indices', () => {
      const inputs = [
        'SELECT id',
        'SELECT * FROM users WHERE id = 1',
        "SELECT 'abc",
        "SELECT 'abc''def",
        "SELECT 'abc''",
        '/*abc',
        '/*abc*',
        '/*/',
        '"abc',
        '`abc',
        '-- trailing comment',
        "SELECT * FROM t WHERE name = 'a"
      ]

      for (const sql of inputs) {
        for (const token of tokenize(sql)) {
          expect({
            end: token.end,
            sliced: sql.slice(token.start, token.end)
          }).toEqual({
            end: Math.min(token.end, sql.length),
            sliced: token.value
          })

          expect(token.end).toBeGreaterThan(token.start)
        }
      }
    })
  })

  // An unterminated string, comment or quoted identifier exists on every
  // keystroke while the user is still typing one, and the parse runs on every
  // keystroke — so these are the common case, not an edge case.
  describe('unterminated input', () => {
    it('does not run a string past the end of the input', () => {
      const sql = "SELECT 'abc"
      const tokens = tokenize(sql)

      expect(tokens).toEqual([
        { end: 6, start: 0, type: 'keyword', value: 'SELECT' },
        { end: 7, start: 6, type: 'whitespace', value: ' ' },
        { end: sql.length, start: 7, type: 'string', value: "'abc" }
      ])
    })

    it('does not run a block comment past the end of the input', () => {
      const sql = '/*abc'
      const tokens = tokenize(sql)

      expect(tokens).toEqual([
        { end: sql.length, start: 0, type: 'comment', value: '/*abc' }
      ])
    })

    it('does not run a quoted identifier past the end of the input', () => {
      const sql = '"abc'
      const tokens = tokenize(sql)

      expect(tokens).toEqual([
        { end: sql.length, start: 0, type: 'identifier', value: '"abc' }
      ])
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(tokenize('')).toEqual([])
    })

    it('handles qualified names with dots', () => {
      const tokens = tokenize('schema.table')
      const values = tokens.map((t) => t.value)

      expect(values).toEqual(['schema', '.', 'table'])
    })

    it('handles function calls', () => {
      const tokens = tokenize('COUNT(*)')
      const values = tokens.map((t) => t.value)

      expect(values).toEqual(['COUNT', '(', '*', ')'])
    })

    it('handles comparison expressions', () => {
      const tokens = tokenize('age >= 18')
      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual(['age', '>=', '18'])
    })

    it('handles string concatenation', () => {
      const tokens = tokenize("first_name || ' ' || last_name")
      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual(['first_name', '||', "' '", '||', 'last_name'])
    })

    it('handles BETWEEN expression', () => {
      const tokens = tokenize('age BETWEEN 18 AND 65')
      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual(['age', 'BETWEEN', '18', 'AND', '65'])
    })

    it('handles CASE expression', () => {
      const sql = "CASE WHEN status = 'A' THEN 'Active' ELSE 'Inactive' END"
      const tokens = tokenize(sql)
      const values = tokens
        .filter((t) => t.type !== 'whitespace')
        .map((t) => t.value)

      expect(values).toEqual([
        'CASE',
        'WHEN',
        'status',
        '=',
        "'A'",
        'THEN',
        "'Active'",
        'ELSE',
        "'Inactive'",
        'END'
      ])
    })
  })
})
