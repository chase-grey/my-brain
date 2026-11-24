import { useEffect } from 'react'
import { dismissUpdateToast, useAppUpdate } from '../appUpdate'

/** The answer to the settings update button. It goes on its own and takes no taps. */
export function UpdateToast() {
  const { toast } = useAppUpdate()
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => dismissUpdateToast(toast.id), 3000)
    return () => clearTimeout(timer)
  }, [toast])
  if (!toast) return null
  return <div className="toast update-toast" role="status" key={toast.id}><span>{toast.text}</span></div>
}
