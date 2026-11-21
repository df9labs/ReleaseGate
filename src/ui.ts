import { twMerge } from 'tailwind-merge'

export function cx(...classes: Array<string | false | null | undefined>) {
  return twMerge(classes.filter(Boolean).join(' '))
}

export interface Notice { title: string; description?: string; variant?: string }
export function notify(message: Notice) {
  window.dispatchEvent(new CustomEvent<Notice>('releasegate-notice', { detail: message }))
}
