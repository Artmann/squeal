import { createSlice } from '@reduxjs/toolkit'

export interface UiState {
  showGettingStartedScreen?: boolean
}

const initialState: UiState = {
  showGettingStartedScreen: true
}

export const uiSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    gettingStartedCompleted: (state) => {
      state.showGettingStartedScreen = false
    }
  }
})

export const uiActions = uiSlice.actions

export default uiSlice.reducer
