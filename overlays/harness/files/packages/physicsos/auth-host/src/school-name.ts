/** School-name admission is shared by registration, applications and direct creation. */
import { z } from 'zod'

/** Preserve submitted spelling and normalize whitespace. @param value - Submitted name. @returns Display spelling. */
export const normalizeSchoolName = (value: string): string => value.trim().replaceAll(/\s+/gu, ' ')

/** Lookup key without changing submitted display spelling. @param value - School name. @returns Compatibility key. */
export const schoolNameKey = (value: string): string => normalizeSchoolName(value).normalize('NFKC').toLowerCase()

/** Admit genuine unlisted names. @param value - School name. @returns Whether it is a recognizable name. */
export const isValidSchoolName = (value: string): boolean => {
  const name = schoolNameKey(value)
  return name.length > 0 && /\p{L}/u.test(name) && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name)
    && !/^[^\s@]+@[^\s@]+$/u.test(name)
    && !/^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/iu.test(name)
    && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,63}(?::\d+)?(?:[/?#]\S*)?$/iu.test(name)
}

/** Raw durable school rows retain historical names; only new input uses this parser. */
export const schoolNameWire = z.string().min(1).max(64).transform(normalizeSchoolName)
  .refine(isValidSchoolName, { message: '请输入真实学校名称' })
