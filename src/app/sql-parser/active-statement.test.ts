import { describe, expect, it } from 'vitest'

import { findActiveStatementIndex } from './active-statement'
import { createAstFromSql } from './parser'

const sql = 'SELECT 1;\n\nSELECT 2;\n\nSELECT 3;'
const { statements } = createAstFromSql(sql)

describe('findActiveStatementIndex', () => {
  it('returns null when there are no statements', () => {
    expect(findActiveStatementIndex([], 0)).toEqual(null)
  })

  it('returns the statement under the cursor', () => {
    expect(findActiveStatementIndex(statements, 2)).toEqual(0)
    expect(findActiveStatementIndex(statements, 12)).toEqual(1)
    expect(findActiveStatementIndex(statements, 24)).toEqual(2)
  })

  it('returns the closest statement before the cursor between statements', () => {
    expect(findActiveStatementIndex(statements, 10)).toEqual(0)
    expect(findActiveStatementIndex(statements, 21)).toEqual(1)
  })

  it('returns null when the cursor is before every statement', () => {
    const offsetStatements = createAstFromSql('   SELECT 1;').statements

    expect(findActiveStatementIndex(offsetStatements, 0)).toEqual(null)
  })
})
