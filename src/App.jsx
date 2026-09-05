import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import AuthDialog from './AuthDialog'
import { supabase } from './supabase'

const categories = {
  Food: { label: 'Food', color: '#E77745', icon: 'fork' },
  Transport: { label: 'Transport', color: '#497F8F', icon: 'arrow' },
  Shopping: { label: 'Shopping', color: '#A65B70', icon: 'bag' },
}

const storageKey = 'spendary.expenses.v1'
const expenseColumns = 'id, amount, category, note, created_at'
const migrationPromises = new Map()

const dotPositions = [
  [20, 22], [49, 18], [75, 28], [33, 49], [66, 54], [16, 72],
  [48, 78], [81, 72], [13, 44], [87, 49], [56, 39], [32, 80],
]

function CategoryIcon({ type }) {
  if (type === 'fork') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v7m3-7v7M5 3v5a4 4 0 0 0 4 4v9m8 0V3c-3 1-5 4-5 8h5" /></svg>
  }
  if (type === 'arrow') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h12m-4-4 4 4-4 4M19 16H7m4-4-4 4 4 4" /></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2" /></svg>
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(value)
}

function todayLabel() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(new Date())
}

function readStoredExpenses() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]')
    if (!Array.isArray(stored)) return []
    return stored.filter((expense) => (
      expense
      && typeof expense.id === 'string'
      && Number.isFinite(expense.amount)
      && expense.amount > 0
      && Object.hasOwn(categories, expense.category)
      && typeof expense.note === 'string'
    ))
  } catch {
    return []
  }
}

function fromDatabaseExpense(expense) {
  return {
    id: expense.id,
    amount: Number(expense.amount),
    category: expense.category,
    note: expense.note,
    createdAt: expense.created_at,
  }
}

async function migrateStoredExpenses(userId) {
  const storedExpenses = readStoredExpenses()
  if (storedExpenses.length === 0) return 0
  if (migrationPromises.has(userId)) return migrationPromises.get(userId)

  const migration = (async () => {
    const rows = storedExpenses.map((expense) => ({
      amount: expense.amount,
      category: expense.category,
      note: expense.note,
    }))
    const { error } = await supabase.from('expenses').insert(rows)
    if (error) throw error

    // This is intentionally after the awaited cloud insert.
    localStorage.removeItem(storageKey)
    return rows.length
  })()

  migrationPromises.set(userId, migration)
  try {
    return await migration
  } catch (error) {
    migrationPromises.delete(userId)
    throw error
  }
}

async function fetchExpenses() {
  const { data, error } = await supabase
    .from('expenses')
    .select(expenseColumns)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data.map(fromDatabaseExpense)
}

async function insertExpense(expense) {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      amount: expense.amount,
      category: expense.category,
      note: expense.note?.trim() || '',
    })
    .select(expenseColumns)
    .single()
  if (error) throw error
  return fromDatabaseExpense(data)
}

function App() {
  const [expenses, setExpenses] = useState([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [savingExpense, setSavingExpense] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const amountInput = useRef(null)
  const userId = session?.user.id

  const total = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses],
  )
  const subtotals = useMemo(
    () => Object.keys(categories).reduce((result, key) => ({
      ...result,
      [key]: expenses
        .filter((expense) => expense.category === key)
        .reduce((sum, expense) => sum + expense.amount, 0),
    }), {}),
    [expenses],
  )
  const selectedExpense = expenses.find((expense) => expense.id === selectedId)

  function openSheet() {
    if (!session) {
      setAuthOpen(true)
      return
    }
    setSheetOpen(true)
    window.setTimeout(() => amountInput.current?.focus(), 120)
  }

  function closeSheet() {
    setSheetOpen(false)
    setAmount('')
    setCategory('')
    setNote('')
  }

  async function addExpense(expense) {
    const created = await insertExpense(expense)
    setExpenses((current) => [...current, created])
    return created
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !category) return
    setSavingExpense(true)
    setDataError('')
    try {
      await addExpense({ amount: numericAmount, category, note })
      closeSheet()
    } catch {
      setDataError('Could not save this expense. Please try again.')
    } finally {
      setSavingExpense(false)
    }
  }

  async function deleteSelected() {
    if (!selectedId) return
    setDeletingId(selectedId)
    setDataError('')
    const { data, error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', selectedId)
      .select('id')
      .single()

    if (error || !data) {
      setDataError('Could not delete this expense. Please try again.')
    } else {
      setExpenses((current) => current.filter((expense) => expense.id !== selectedId))
      setSelectedId(null)
    }
    setDeletingId(null)
  }

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session)
        setAuthReady(true)
        if (!data.session) setDataLoading(false)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
      if (!nextSession) {
        setExpenses([])
        setSelectedId(null)
        setDataLoading(false)
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()
    if (error) setDataError('Could not sign out. Please try again.')
    setSigningOut(false)
  }

  useEffect(() => {
    if (!authReady || !userId) return undefined

    let active = true
    ;(async () => {
      setDataLoading(true)
      setDataError('')
      try {
        await migrateStoredExpenses(userId)
        const cloudExpenses = await fetchExpenses()
        if (active) setExpenses(cloudExpenses)
      } catch {
        if (active) setDataError('Could not load your cloud expenses. Any browser copy has been kept.')
      } finally {
        if (active) setDataLoading(false)
      }
    })()

    return () => { active = false }
  }, [authReady, userId])

  useEffect(() => {
    if (!sheetOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleKeyDown(event) {
      if (event.key === 'Escape') closeSheet()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [sheetOpen])

  useEffect(() => {
    const context = document.modelContext
    if (!context?.registerTool) return undefined
    const lifecycle = new AbortController()
    const allowedCategories = Object.keys(categories)
    Promise.resolve(context.registerTool({
      name: 'add_expense',
      title: 'Add expense',
      description: 'Add one expense to today’s Spendary map.',
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          category: { type: 'string', enum: allowedCategories },
          note: { type: 'string', maxLength: 80 },
        },
        required: ['amount', 'category'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!userId) throw new Error('Sign in before adding an expense.')
        if (!input || !Number.isFinite(input.amount) || input.amount <= 0) {
          throw new Error('Amount must be greater than zero.')
        }
        if (!allowedCategories.includes(input.category)) {
          throw new Error('Choose Food, Transport, or Shopping.')
        }
        const expense = await addExpense(input)
        return { id: expense.id, total: expense.amount, category: expense.category }
      },
    }, { signal: lifecycle.signal })).catch(() => {})
    return () => lifecycle.abort()
  }, [userId])

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Spendary home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Spendary</span>
        </a>
        <div className="topbar-actions">
          {session ? (
            <div className="account-chip">
              <span title={session.user.email}>{session.user.email}</span>
              <button type="button" onClick={handleSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
            </div>
          ) : (
            <button className="account-button" type="button" onClick={() => setAuthOpen(true)} disabled={!authReady}>Sign in</button>
          )}
          <button className="round-button" type="button" aria-label="Add an expense" onClick={openSheet}>+</button>
        </div>
      </header>

      <main id="top">
        {dataError && <p className="data-error" role="alert">{dataError}</p>}
        <section className="intro" aria-labelledby="today-heading">
          <p className="eyebrow">{todayLabel()}</p>
          <div className="title-row">
            <div>
              <h1 id="today-heading">Today’s map</h1>
              <p className="intro-copy">A little picture of where your money went.</p>
            </div>
            <div className="total-block" aria-label={`Today’s total ${formatMoney(total)}`}>
              <span>Total</span>
              <strong>{formatMoney(total)}</strong>
            </div>
          </div>
        </section>

        <div className="dashboard-grid">
          <section className={`map-card ${expenses.length ? 'has-dots' : ''}`} aria-label="Today’s expense map">
            <div className="map-heading">
              <span>{expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'}</span>
              {expenses.length > 0 && <span className="map-hint">Tap a dot for details</span>}
            </div>
            <div className="map-canvas">
              {expenses.length === 0 ? (
                <div className="empty-map">
                  <div className="empty-orbit" aria-hidden="true"><span /><span /><span /></div>
                  <h2>{dataLoading ? 'Loading your map' : 'Your map is clear'}</h2>
                  <p>{dataLoading ? 'Bringing your expenses into view.' : 'Add your first expense and watch the day take shape.'}</p>
                  {!dataLoading && <button type="button" className="text-button" onClick={openSheet}>Add an expense <span>↗</span></button>}
                </div>
              ) : expenses.map((expense, index) => {
                const position = dotPositions[index % dotPositions.length]
                const size = Math.max(44, Math.min(92, 38 + Math.sqrt(expense.amount) * 5))
                return (
                  <button
                    type="button"
                    className={`expense-dot ${selectedId === expense.id ? 'is-selected' : ''}`}
                    style={{
                      '--dot-color': categories[expense.category].color,
                      '--dot-size': `${size}px`,
                      left: `${position[0]}%`, top: `${position[1]}%`,
                      animationDelay: `${Math.min(index, 8) * 45}ms`,
                    }}
                    key={expense.id}
                    aria-label={`${expense.category}, ${formatMoney(expense.amount)}`}
                    onClick={() => setSelectedId(expense.id)}
                  >
                    <span className="dot-amount">{Math.round(expense.amount)}</span>
                    {expense.note && <span className="dot-label">{expense.note}</span>}
                  </button>
                )
              })}
            </div>
          </section>

          <aside className="side-panel">
            <section className="category-card" aria-labelledby="categories-heading">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Breakdown</p>
                  <h2 id="categories-heading">By category</h2>
                </div>
                <span className="mini-total">{formatMoney(total)}</span>
              </div>
              <div className="category-list">
                {Object.entries(categories).map(([key, item]) => (
                  <div className="category-row" key={key}>
                    <span className="category-icon" style={{ '--category-color': item.color }}><CategoryIcon type={item.icon} /></span>
                    <span className="category-name">{item.label}</span>
                    <strong>{formatMoney(subtotals[key])}</strong>
                  </div>
                ))}
              </div>
            </section>

            {selectedExpense ? (
              <section className="detail-card" aria-live="polite">
                <button className="close-detail" type="button" aria-label="Close expense details" onClick={() => setSelectedId(null)}>×</button>
                <span className="detail-dot" style={{ '--category-color': categories[selectedExpense.category].color }} />
                <div>
                  <p>{selectedExpense.category}</p>
                  <strong>{formatMoney(selectedExpense.amount)}</strong>
                  {selectedExpense.note && <span>{selectedExpense.note}</span>}
                </div>
                <button className="delete-button" type="button" onClick={deleteSelected} disabled={deletingId === selectedExpense.id}>{deletingId === selectedExpense.id ? 'Deleting…' : 'Delete'}</button>
              </section>
            ) : (
              <section className="quote-card" aria-label="Spendary note">
                <span aria-hidden="true">“</span>
                <p>Small moments make the whole picture.</p>
              </section>
            )}
          </aside>
        </div>
      </main>

      <button className="add-button" type="button" onClick={openSheet}>
        <span aria-hidden="true">+</span> Add expense
      </button>

      {sheetOpen && (
        <div className="sheet-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSheet()
        }}>
          <section className="expense-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-heading">
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-title-row">
              <div>
                <p className="eyebrow">New dot</p>
                <h2 id="sheet-heading">Add an expense</h2>
              </div>
              <button className="sheet-close" type="button" onClick={closeSheet} aria-label="Close add expense form">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <label className="amount-field">
                <span>Amount</span>
                <span className="amount-control"><b>$</b><input ref={amountInput} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} required /></span>
              </label>
              <fieldset>
                <legend>Category</legend>
                <div className="category-options">
                  {Object.entries(categories).map(([key, item]) => (
                    <label className={category === key ? 'selected' : ''} key={key} style={{ '--category-color': item.color }}>
                      <input type="radio" name="category" value={key} checked={category === key} onChange={() => setCategory(key)} />
                      <span className="category-icon"><CategoryIcon type={item.icon} /></span>
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="note-field">
                <span>Note <em>optional</em></span>
                <input type="text" maxLength="80" placeholder="Coffee with Mia" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <button className="save-button" type="submit" disabled={!amount || Number(amount) <= 0 || !category || savingExpense}>{savingExpense ? 'Saving…' : 'Create dot'} <span>↗</span></button>
            </form>
          </section>
        </div>
      )}
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

export default App
