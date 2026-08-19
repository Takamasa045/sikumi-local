export const UNREGISTER_PLACE_CONFIRM =
  'この場所の観測を外しますか？フォルダ自体は残ります。'

export function confirmUnregisterPlace(): boolean {
  return window.confirm(UNREGISTER_PLACE_CONFIRM)
}
