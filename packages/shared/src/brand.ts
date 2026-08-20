export type Brand<T, B extends string> = T & {
  readonly __brand: B
}

export function brand<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>
}
