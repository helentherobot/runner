import type { Recipe } from './types.js'

export function recipe<TArgs extends unknown[]>(def: Recipe<TArgs>): Recipe<TArgs> {
  return def
}
