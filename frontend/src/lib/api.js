const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

function getStoredSession() {
  try {
    const stored =
      sessionStorage.getItem('fullstock_session') ||
      localStorage.getItem('fullstock_session') ||
      'null'

    return JSON.parse(stored)
  } catch {
    return null
  }
}

async function request(path, options = {}) {
  const session = getStoredSession()
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (session?.token) headers.Authorization = 'Bearer ' + session.token
  const response = await fetch(API_BASE + path, { ...options, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload.message || Object.values(payload.errors || {})[0]?.[0] || 'Request failed.'
    throw new Error(message)
  }
  return payload
}

async function assistantRequest(question, conversation = [], onToken) {
  const session = getStoredSession()
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  }
  if (session?.token) headers.Authorization = 'Bearer ' + session.token

  const response = await fetch(API_BASE + '/assistant', {
    method: 'POST',
    headers,
    body: JSON.stringify({ question, conversation }),
  })

  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const message = payload.message || Object.values(payload.errors || {})[0]?.[0] || 'The AI Assistant request failed.'
    throw new Error(message)
  }
  if (!contentType.includes('text/event-stream')) return response.json()
  if (!response.body) throw new Error('The AI Assistant response stream was empty. Please try again.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamFinished = false
  let providerError = null

  const consumeEvent = (block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data) return
    let event
    try { event = JSON.parse(data) } catch { return }
    if (event.error) providerError = event.error
    if (typeof event.token === 'string' && event.token) onToken?.(event.token)
    if (event.done === true) streamFinished = true
  }

  while (!streamFinished && !providerError) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    if (done) {
      if (buffer.trim()) consumeEvent(buffer)
      break
    }
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      consumeEvent(block)
      if (streamFinished || providerError) break
    }
  }

  if (providerError) {
    await reader.cancel().catch(() => {})
    throw new Error(providerError)
  }
  if (!streamFinished) throw new Error('The AI response stopped before it was complete. Please try again.')
  return { streamed: true }
}

export const api = {
  setupStatus: () => request('/setup/status'),
  setupAdministrator: (data) => request('/setup/administrator', { method: 'POST', body: JSON.stringify(data) }),
  login: (email, password) => request('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  createStaffAccount: (data) => request('/staff-accounts', { method: 'POST', body: JSON.stringify(data) }),
  staffAccounts: () => request('/staff-accounts'),
  updateStaffAccount: (id, data) =>
    request(`/staff-accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateStaffAccountStatus: (id, isActive) =>
    request(`/staff-accounts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive }),
    }),
  deleteStaffAccount: (id) =>
    request(`/staff-accounts/${id}`, { method: 'DELETE' }),
  forgotPassword: (email) => request('/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  submitPasswordResetRequest: (data) => request('/password-reset-requests', { method: 'POST', body: JSON.stringify(data)}),
  passwordResetRequests: () => request('/password-reset-requests'),
  deletePasswordResetRequest: (id) => request('/password-reset-requests/' + id, { method: 'DELETE' }),
  resetStaffPassword: (id) => request('/password-reset-requests/' + id + '/reset', { method: 'POST' }),
  changeTemporaryPassword: (data) => request('/password/change', { method: 'POST', body: JSON.stringify(data) }),
  resetPassword: (data) => request('/reset-password', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request('/logout', { method: 'POST' }),
  products: () => request('/products'),
  suppliers: () => request('/suppliers'),
  sales: () => request('/sales'),
  movements: () => request('/inventory/movements'),
  batches: () => request('/inventory/batches'),
  create: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
  update: (path, id, data) => request(path + '/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (path, id) => request(path + '/' + id, { method: 'DELETE' }),
  assistant: (question, conversation = [], onToken) => assistantRequest(question, conversation, onToken),
  receiveBatch: (data) => request('/inventory/batches', { method: 'POST', body: JSON.stringify(data) }),
  updateBatch: (id, data) => request('/inventory/batches/' + id, { method: 'PATCH', body: JSON.stringify(data) }),
  createSale: (data) => request('/sales', { method: 'POST', body: JSON.stringify(data) }),
  voidApprovers: (id) => request(`/sales/${id}/void-approvers`),
  requestVoidCode: (id, data) => request(`/sales/${id}/void-code`, { method: 'POST', body: JSON.stringify(data) }),
  voidApprovals: () => request('/void-approvals'),
  voidSale: (id, reason, approvalCode = null) => request(`/sales/${id}/void`, { method: 'POST', body: JSON.stringify({ reason, ...(approvalCode ? { approval_code: approvalCode } : {}) }) }),
}

export async function loadWorkspace() {
  const [products, suppliers, sales, movements, batches] = await Promise.all([
    api.products(), api.suppliers(), api.sales(), api.movements(), api.batches(),
  ])
  const visibleProducts = products.map((product) => {
    const visibleProduct = { ...product }
    delete visibleProduct.sku
    return visibleProduct
  })
  const now = new Date()
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  const productsWithSellableStock = visibleProducts.map((product) => ({
    ...product,
    available_stock: batches
      .filter((batch) => String(batch.product_id) === String(product.id)
        && Number(batch.remaining_quantity) > 0
        && (!batch.expiration_date || String(batch.expiration_date).slice(0, 10) >= today))
      .reduce((total, batch) => total + Number(batch.remaining_quantity || 0), 0),
  }))
  return { products: productsWithSellableStock, suppliers, sales, movements, batches }
}
