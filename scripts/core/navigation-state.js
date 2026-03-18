export function createNavigationUiState() {
  return {
    profileMenuOpen: false,
    notificationsExpanded: false
  };
}

export function closeProfileMenu(state) {
  state.profileMenuOpen = false;
  state.notificationsExpanded = false;
}

export function toggleProfileMenu(state) {
  state.profileMenuOpen = !state.profileMenuOpen;
  if (!state.profileMenuOpen) {
    state.notificationsExpanded = false;
  }
  return state.profileMenuOpen;
}

export function toggleNotificationsPanel(state, { count = 0, loading = false } = {}) {
  state.profileMenuOpen = true;
  if (!count && !loading) {
    state.notificationsExpanded = false;
    return false;
  }
  state.notificationsExpanded = !state.notificationsExpanded;
  return state.notificationsExpanded;
}

export function keepProfileMenuOpen(state) {
  state.profileMenuOpen = true;
}

export function clampNotificationsPanel(state, { count = 0, loading = false } = {}) {
  if (!count && !loading) {
    state.notificationsExpanded = false;
  }
  return state.notificationsExpanded;
}
