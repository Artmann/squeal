import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { QueryDto } from '@/main/queries'

interface QueriesState {
  queries: QueryDto[]
}

const initialState: QueriesState = {
  queries: []
}

export const queriesSlice = createSlice({
  name: 'queries',
  initialState,
  reducers: {
    queriesFetched: (state, action: PayloadAction<QueryDto[]>) => {
      state.queries = action.payload
    },
    queryCreated: (state, action: PayloadAction<QueryDto>) => {
      state.queries.push(action.payload)
    },
    queryFetched: (state, action: PayloadAction<QueryDto>) => {
      const index = state.queries.findIndex(
        (query) => query.id === action.payload.id
      )

      if (index >= 0) {
        state.queries[index] = action.payload
      } else {
        state.queries.push(action.payload)
      }
    }
  }
})

export const { queriesFetched, queryCreated, queryFetched } =
  queriesSlice.actions

export default queriesSlice.reducer
