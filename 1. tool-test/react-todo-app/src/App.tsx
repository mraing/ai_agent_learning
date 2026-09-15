import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Filter = 'all' | 'active' | 'completed'

interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: number
}

const STORAGE_KEY = 'react-todo-app:todos'

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Todo =>
        item &&
        typeof item.id === 'string' &&
        typeof item.text === 'string' &&
        typeof item.completed === 'boolean',
    )
  } catch {
    return []
  }
}

function App() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  const [input, setInput] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [leavingIds, setLeavingIds] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)

  // localStorage 持久化
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

  useEffect(() => {
    if (editingId) editRef.current?.focus()
  }, [editingId])

  const addTodo = () => {
    const text = input.trim()
    if (!text) return
    const todo: Todo = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      completed: false,
      createdAt: Date.now(),
    }
    setTodos((prev) => [todo, ...prev])
    setInput('')
    inputRef.current?.focus()
  }

  const removeTodo = (id: string) => {
    // 先播放退出动画，再真正删除
    setLeavingIds((prev) => [...prev, id])
    window.setTimeout(() => {
      setTodos((prev) => prev.filter((t) => t.id !== id))
      setLeavingIds((prev) => prev.filter((item) => item !== id))
    }, 280)
  }

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
    )
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditingText(todo.text)
  }

  const commitEdit = () => {
    if (editingId === null) return
    const text = editingText.trim()
    if (!text) {
      removeTodo(editingId)
    } else {
      setTodos((prev) =>
        prev.map((t) => (t.id === editingId ? { ...t, text } : t)),
      )
    }
    setEditingId(null)
    setEditingText('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingText('')
  }

  const clearCompleted = () => {
    setTodos((prev) => prev.filter((t) => !t.completed))
  }

  const toggleAll = () => {
    const allDone = todos.length > 0 && todos.every((t) => t.completed)
    setTodos((prev) => prev.map((t) => ({ ...t, completed: !allDone })))
  }

  const stats = useMemo(() => {
    const total = todos.length
    const completed = todos.filter((t) => t.completed).length
    const active = total - completed
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
    return { total, completed, active, percent }
  }, [todos])

  const visibleTodos = useMemo(() => {
    if (filter === 'active') return todos.filter((t) => !t.completed)
    if (filter === 'completed') return todos.filter((t) => t.completed)
    return todos
  }, [todos, filter])

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: stats.total },
    { key: 'active', label: '进行中', count: stats.active },
    { key: 'completed', label: '已完成', count: stats.completed },
  ]

  return (
    <div className="app">
      <div className="card">
        <header className="header">
          <h1>📝 我的待办清单</h1>
          <p className="subtitle">保持专注，逐个击破</p>
        </header>

        <div className="input-row">
          <input
            ref={inputRef}
            className="todo-input"
            value={input}
            placeholder="今天要做点什么？"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTodo()
            }}
          />
          <button className="add-btn" onClick={addTodo} disabled={!input.trim()}>
            + 添加
          </button>
        </div>

        <div className="stats">
          <div className="stats-text">
            <span className="stats-item">
              总计 <strong>{stats.total}</strong>
            </span>
            <span className="stats-item">
              进行中 <strong>{stats.active}</strong>
            </span>
            <span className="stats-item">
              已完成 <strong>{stats.completed}</strong>
            </span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${stats.percent}%` }} />
          </div>
          <span className="progress-label">{stats.percent}%</span>
        </div>

        <div className="toolbar">
          <div className="filters">
            {filters.map((f) => (
              <button
                key={f.key}
                className={`filter-btn ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="badge">{f.count}</span>
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <button
              className="text-btn"
              onClick={toggleAll}
              disabled={stats.total === 0}
            >
              {stats.active === 0 && stats.total > 0 ? '取消全选' : '全部完成'}
            </button>
            <button
              className="text-btn danger"
              onClick={clearCompleted}
              disabled={stats.completed === 0}
            >
              清除已完成
            </button>
          </div>
        </div>

        <ul className="todo-list">
          {visibleTodos.map((todo) => {
            const isLeaving = leavingIds.includes(todo.id)
            const isEditing = editingId === todo.id
            return (
              <li
                key={todo.id}
                className={`todo-item ${todo.completed ? 'completed' : ''} ${
                  isLeaving ? 'leaving' : 'entering'
                }`}
              >
                <button
                  className={`checkbox ${todo.completed ? 'checked' : ''}`}
                  onClick={() => toggleTodo(todo.id)}
                  aria-label={todo.completed ? '标记为未完成' : '标记为已完成'}
                >
                  {todo.completed ? '✓' : ''}
                </button>

                {isEditing ? (
                  <input
                    ref={editRef}
                    className="edit-input"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') cancelEdit()
                    }}
                  />
                ) : (
                  <span
                    className="todo-text"
                    onDoubleClick={() => startEdit(todo)}
                    title="双击编辑"
                  >
                    {todo.text}
                  </span>
                )}

                <div className="item-actions">
                  {isEditing ? (
                    <>
                      <button className="icon-btn save" onClick={commitEdit}>
                        保存
                      </button>
                      <button className="icon-btn" onClick={cancelEdit}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="icon-btn"
                        onClick={() => startEdit(todo)}
                      >
                        编辑
                      </button>
                      <button
                        className="icon-btn delete"
                        onClick={() => removeTodo(todo.id)}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {visibleTodos.length === 0 && (
          <div className="empty">
            {stats.total === 0
              ? '还没有任务，添加第一条吧 🎯'
              : '这个分类下暂无任务 ✨'}
          </div>
        )}

        <footer className="footer">双击任务文字即可编辑 · 数据自动保存到本地</footer>
      </div>
    </div>
  )
}

export default App
