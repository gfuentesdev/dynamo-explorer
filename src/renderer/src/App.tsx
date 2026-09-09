import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type {
  AwsProfile,
  DynamoItem,
  DynamoValue,
  ExploreRequest,
  ExploreResult,
  FilterCondition,
  FilterOperator,
  IndexDefinition,
  ScalarInputType,
  SortKeyOperator,
  TableSchema,
  TypedInput,
} from '../../shared/types'
import { sortDynamoItems } from './sorting'
import type { SortDirection } from './sorting'
import { createTranslator, getInitialLocale, localizeError } from './i18n'
import type { Locale, Translate } from './i18n'

const REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'sa-east-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-north-1',
  'eu-south-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'me-south-1',
]

interface UiFilter extends FilterCondition {
  id: string
}

interface DeleteCandidate {
  item: DynamoItem
  key: DynamoItem
}

interface AttributeOption {
  path: string
  valueType?: ScalarInputType
}

const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 560
const SIDEBAR_DEFAULT_WIDTH = 280

export default function App(): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(getInitialLocale)
  const [profiles, setProfiles] = useState<AwsProfile[]>([])
  const [profile, setProfile] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [tables, setTables] = useState<string[]>([])
  const [tablesTruncated, setTablesTruncated] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState('')
  const [schema, setSchema] = useState<TableSchema>()
  const [indexName, setIndexName] = useState('')
  const [mode, setMode] = useState<'scan' | 'query'>('scan')
  const [partitionValue, setPartitionValue] = useState('')
  const [sortOperator, setSortOperator] = useState<SortKeyOperator | ''>('')
  const [sortValue, setSortValue] = useState('')
  const [sortSecondValue, setSortSecondValue] = useState('')
  const [filters, setFilters] = useState<UiFilter[]>([])
  const [limit, setLimit] = useState(50)
  const [result, setResult] = useState<ExploreResult>()
  const [currentCursor, setCurrentCursor] = useState<DynamoItem>()
  const [cursorHistory, setCursorHistory] = useState<Array<DynamoItem | undefined>>([])
  const [loadingTables, setLoadingTables] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate>()
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState<'deleteSuccess' | 'deleteMissing' | ''>('')
  const [attributeOptions, setAttributeOptions] = useState<AttributeOption[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = Number(localStorage.getItem('dynamo-explorer:sidebar-width'))
    return Number.isFinite(savedWidth) ? clampSidebarWidth(savedWidth) : SIDEBAR_DEFAULT_WIDTH
  })
  const [sortColumn, setSortColumn] = useState('')
  const [sortDirection, setSortDirection] = useState<SortDirection>('ascending')
  const t = useMemo(() => createTranslator(locale), [locale])

  const selectedIndex = useMemo(
    () => schema?.indexes.find((index) => (indexName ? index.name === indexName : index.kind === 'TABLE')),
    [schema, indexName],
  )

  const filteredTables = useMemo(() => {
    const search = tableSearch.trim().toLocaleLowerCase()
    return search ? tables.filter((table) => table.toLocaleLowerCase().includes(search)) : tables
  }, [tableSearch, tables])

  const columns = useMemo(() => {
    if (!result) return []
    const discovered = new Set(result.items.flatMap((item) => Object.keys(item)))
    const tableIndex = schema?.indexes.find((index) => index.kind === 'TABLE')
    const keyNames = [tableIndex?.partitionKey.name, tableIndex?.sortKey?.name].filter(Boolean) as string[]
    return [...keyNames, ...[...discovered].filter((name) => !keyNames.includes(name)).sort()]
  }, [result, schema])

  const sortedItems = useMemo(
    () => result ? sortDynamoItems(result.items, sortColumn, sortDirection) : [],
    [result, sortColumn, sortDirection],
  )

  useEffect(() => {
    document.documentElement.lang = locale
    localStorage.setItem('dynamo-explorer:locale', locale)
  }, [locale])

  useEffect(() => {
    let active = true
    void window.dynamoExplorer
      .listProfiles()
      .then((availableProfiles) => {
        if (!active) return
        setProfiles(availableProfiles)
        const savedProfile = localStorage.getItem('dynamo-explorer:profile')
        const initial = availableProfiles.find((entry) => entry.name === savedProfile) ?? availableProfiles[0]
        if (initial) {
          setProfile(initial.name)
          setRegion(localStorage.getItem('dynamo-explorer:region') || initial.region || 'us-east-1')
        }
      })
      .catch((caught) => active && setError(errorMessage(caught)))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!profile || !region) return
    localStorage.setItem('dynamo-explorer:profile', profile)
    localStorage.setItem('dynamo-explorer:region', region)
    setSelectedTable('')
    setSchema(undefined)
    setResult(undefined)
    setAttributeOptions([])
    setSortColumn('')
    void refreshTables(profile, region)
  }, [profile, region])

  async function refreshTables(selectedProfile = profile, selectedRegion = region): Promise<void> {
    if (!selectedProfile || !selectedRegion) return
    setLoadingTables(true)
    setError('')
    try {
      const response = await window.dynamoExplorer.listTables({ profile: selectedProfile, region: selectedRegion })
      setTables(response.tableNames)
      setTablesTruncated(response.truncated)
    } catch (caught) {
      setTables([])
      setError(errorMessage(caught))
    } finally {
      setLoadingTables(false)
    }
  }

  async function openTable(tableName: string): Promise<void> {
    setSelectedTable(tableName)
    setSchema(undefined)
    setResult(undefined)
    setAttributeOptions([])
    setSortColumn('')
    setIndexName('')
    setMode('scan')
    setFilters([])
    setPartitionValue('')
    setSortOperator('')
    setCurrentCursor(undefined)
    setCursorHistory([])
    setLoadingData(true)
    setError('')
    try {
      const nextSchema = await window.dynamoExplorer.describeTable({ profile, region, tableName })
      setSchema(nextSchema)
      const response = await window.dynamoExplorer.explore({
        profile,
        region,
        tableName,
        mode: 'scan',
        filters: [],
        limit,
      })
      setResult(response)
      setAttributeOptions(discoverAttributeOptions(nextSchema, response.items))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoadingData(false)
    }
  }

  function createExploreRequest(cursor?: DynamoItem): ExploreRequest {
    if (!selectedTable || !selectedIndex) throw new Error(t('selectValidTable'))
    const request: ExploreRequest = {
      profile,
      region,
      tableName: selectedTable,
      indexName: indexName || undefined,
      mode,
      filters: filters.map(({ id: _id, ...filter }) => filter),
      limit,
      cursor,
    }
    if (mode === 'query') {
      request.partitionKeyValue = typedKeyInput(selectedIndex.partitionKey.type, partitionValue)
      if (sortOperator && selectedIndex.sortKey) {
        request.sortKeyCondition = {
          operator: sortOperator,
          value: typedKeyInput(selectedIndex.sortKey.type, sortValue),
          secondValue:
            sortOperator === 'between' ? typedKeyInput(selectedIndex.sortKey.type, sortSecondValue) : undefined,
        }
      }
    }
    return request
  }

  async function runExplore(cursor?: DynamoItem, resetHistory = false): Promise<void> {
    setLoadingData(true)
    setError('')
    setNotice('')
    try {
      const response = await window.dynamoExplorer.explore(createExploreRequest(cursor))
      setResult(response)
      setAttributeOptions((current) => mergeAttributeOptions(current, discoverAttributeOptions(schema, response.items)))
      setCurrentCursor(cursor)
      if (resetHistory) setCursorHistory([])
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoadingData(false)
    }
  }

  async function nextPage(): Promise<void> {
    if (!result?.lastEvaluatedKey) return
    setCursorHistory((history) => [...history, currentCursor])
    await runExplore(result.lastEvaluatedKey)
  }

  async function previousPage(): Promise<void> {
    if (cursorHistory.length === 0) return
    const previous = cursorHistory[cursorHistory.length - 1]
    setCursorHistory((history) => history.slice(0, -1))
    await runExplore(previous)
  }

  function addFilter(): void {
    if (filters.length >= 8) return
    setFilters((current) => [
      ...current,
      { id: crypto.randomUUID(), path: '', operator: 'eq', valueType: 'string', value: '' },
    ])
  }

  function updateFilter(id: string, patch: Partial<UiFilter>): void {
    setFilters((current) => current.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)))
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    document.body.classList.add('resizing-sidebar')

    const resize = (moveEvent: PointerEvent): void => {
      const nextWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX)
      setSidebarWidth(nextWidth)
      localStorage.setItem('dynamo-explorer:sidebar-width', String(nextWidth))
    }
    const finish = (): void => {
      document.body.classList.remove('resizing-sidebar')
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  function resizeSidebarWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    let nextWidth = sidebarWidth
    if (event.key === 'ArrowLeft') nextWidth -= 16
    else if (event.key === 'ArrowRight') nextWidth += 16
    else if (event.key === 'Home') nextWidth = SIDEBAR_MIN_WIDTH
    else if (event.key === 'End') nextWidth = SIDEBAR_MAX_WIDTH
    else return

    event.preventDefault()
    nextWidth = clampSidebarWidth(nextWidth)
    setSidebarWidth(nextWidth)
    localStorage.setItem('dynamo-explorer:sidebar-width', String(nextWidth))
  }

  function toggleColumnSort(column: string): void {
    if (sortColumn === column) {
      setSortDirection((current) => current === 'ascending' ? 'descending' : 'ascending')
      return
    }
    setSortColumn(column)
    setSortDirection('ascending')
  }

  function requestDelete(item: DynamoItem): void {
    if (!schema) return
    const tableIndex = schema.indexes.find((index) => index.kind === 'TABLE')
    if (!tableIndex) return
    const names = [tableIndex.partitionKey.name, tableIndex.sortKey?.name].filter(Boolean) as string[]
    const key = Object.fromEntries(names.map((name) => [name, item[name]]).filter((entry) => Boolean(entry[1])))
    setDeleteCandidate({ item, key })
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteCandidate) return
    setDeleting(true)
    setError('')
    try {
      const response = await window.dynamoExplorer.deleteItem({
        profile,
        region,
        tableName: selectedTable,
        key: deleteCandidate.key,
      })
      setResult((current) =>
        current ? { ...current, items: current.items.filter((item) => item !== deleteCandidate.item) } : current,
      )
      setNotice(response.deleted ? 'deleteSuccess' : 'deleteMissing')
      setDeleteCandidate(undefined)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setDeleting(false)
    }
  }

  const isProduction = /(^|[-_.])(prod|production|live)([-_.]|$)/i.test(`${profile} ${selectedTable}`)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">D</div>
        <div className="brand-copy">
          <strong>Dynamo Explorer</strong>
          <span>{t('workspaceSubtitle')}</span>
        </div>
        <div className="connection-controls">
          <label>
            <span>{t('profile')}</span>
            <select
              value={profile}
              onChange={(event) => {
                const nextProfile = profiles.find((entry) => entry.name === event.target.value)
                setProfile(event.target.value)
                if (nextProfile?.region) setRegion(nextProfile.region)
              }}
            >
              {profiles.length === 0 && <option value="">{t('noProfiles')}</option>}
              {profiles.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}{entry.isSso ? ' · SSO' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('region')}</span>
            <input value={region} list="aws-regions" onChange={(event) => setRegion(event.target.value)} />
            <datalist id="aws-regions">
              {REGIONS.map((entry) => <option key={entry} value={entry} />)}
            </datalist>
          </label>
          <button className="icon-button" onClick={() => void refreshTables()} disabled={!profile || loadingTables} title={t('refreshTables')}>
            <RefreshIcon spinning={loadingTables} />
          </button>
        </div>
        <div className="language-control" aria-label={t('language')}>
          <span className={locale === 'en' ? 'active' : ''}>EN</span>
          <button
            className="language-switch"
            type="button"
            role="switch"
            aria-checked={locale === 'es'}
            aria-label={locale === 'en' ? t('switchToSpanish') : t('switchToEnglish')}
            title={locale === 'en' ? t('switchToSpanish') : t('switchToEnglish')}
            onClick={() => setLocale((current) => current === 'en' ? 'es' : 'en')}
          >
            <span aria-hidden="true" />
          </button>
          <span className={locale === 'es' ? 'active' : ''}>ES</span>
        </div>
        <div className="security-pill"><ShieldIcon /> {t('localCredentials')}</div>
      </header>

      <div className="workspace">
        <aside className="sidebar" style={{ width: sidebarWidth, flexBasis: sidebarWidth }}>
          <div className="sidebar-heading">
            <div>
              <span>{t('tables')}</span>
              <strong>{tables.length}</strong>
            </div>
            {tablesTruncated && <small>{t('showingFirstThousand')}</small>}
          </div>
          <div className="search-box">
            <SearchIcon />
            <input placeholder={t('searchTables')} value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} />
          </div>
          <nav className="table-list" aria-label={t('dynamoTables')}>
            {loadingTables && tables.length === 0 && <SidebarSkeleton />}
            {!loadingTables && profile && tables.length === 0 && <div className="sidebar-empty">{t('noTables')}</div>}
            {!profile && <div className="sidebar-empty">{t('configureProfile')}</div>}
            {filteredTables.map((table) => (
              <button key={table} className={table === selectedTable ? 'active' : ''} onClick={() => void openTable(table)}>
                <TableIcon /> <span>{table}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer"><DatabaseIcon /> {region}</div>
        </aside>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label={t('resizeTablePanel')}
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          title={t('dragToResize')}
          onPointerDown={startSidebarResize}
          onKeyDown={resizeSidebarWithKeyboard}
        />

        <main className="main-panel">
          {!selectedTable ? (
            <EmptyState hasProfiles={profiles.length > 0} t={t} />
          ) : (
            <>
              <section className="table-header">
                <div>
                  <div className="eyebrow">{t('dynamodbTable')}</div>
                  <h1>{selectedTable}</h1>
                  {schema && (
                    <div className="table-meta">
                      <span className={`status-dot ${schema.status === 'ACTIVE' ? 'online' : ''}`} /> {schema.status ?? '—'}
                      <span>{t('estimatedRecords', { count: formatInteger(schema.itemCount, locale) })}</span>
                      <span>{formatBytes(schema.sizeBytes)}</span>
                    </div>
                  )}
                </div>
                <div className="header-actions">
                  {isProduction && <span className="production-badge">{t('production')}</span>}
                  <button className="secondary-button" onClick={() => void runExplore(currentCursor)} disabled={loadingData || !schema}>
                    <RefreshIcon spinning={loadingData} /> {t('refresh')}
                  </button>
                </div>
              </section>

              {schema && selectedIndex && (
                <section className="query-panel">
                  <div className="query-toolbar">
                    <div className="segmented" role="group" aria-label={t('operationType')}>
                      <button className={mode === 'scan' ? 'active' : ''} onClick={() => setMode('scan')}>Scan</button>
                      <button className={mode === 'query' ? 'active' : ''} onClick={() => setMode('query')}>Query</button>
                    </div>
                    <label className="compact-field">
                      <span>{t('source')}</span>
                      <select
                        value={indexName}
                        onChange={(event) => {
                          setIndexName(event.target.value)
                          setPartitionValue('')
                          setSortOperator('')
                        }}
                      >
                        {schema.indexes.map((index) => (
                          <option key={`${index.kind}:${index.name}`} value={index.kind === 'TABLE' ? '' : index.name}>
                            {index.kind === 'TABLE' ? t('mainTable') : `${index.name} · ${index.kind}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="compact-field limit-field">
                      <span>{t('limit')}</span>
                      <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                        {[25, 50, 100, 200].map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </label>
                  </div>

                  {mode === 'query' && (
                    <div className="key-builder">
                      <label className="field grow">
                        <span><KeyIcon /> Partition key · {selectedIndex.partitionKey.name} <em>{selectedIndex.partitionKey.type}</em></span>
                        <input
                          value={partitionValue}
                          onChange={(event) => setPartitionValue(event.target.value)}
                          placeholder={t('valueFor', { name: selectedIndex.partitionKey.name })}
                        />
                      </label>
                      {selectedIndex.sortKey && (
                        <>
                          <label className="field operator-field">
                            <span>Sort key · {selectedIndex.sortKey.name}</span>
                            <select value={sortOperator} onChange={(event) => setSortOperator(event.target.value as SortKeyOperator | '')}>
                              <option value="">{t('noCondition')}</option>
                              <option value="eq">=</option>
                              <option value="beginsWith">{t('beginsWith')}</option>
                              <option value="between">{t('between')}</option>
                              <option value="lt">&lt;</option>
                              <option value="lte">≤</option>
                              <option value="gt">&gt;</option>
                              <option value="gte">≥</option>
                            </select>
                          </label>
                          {sortOperator && (
                            <label className="field grow">
                              <span>{t('value')}</span>
                              <input value={sortValue} onChange={(event) => setSortValue(event.target.value)} />
                            </label>
                          )}
                          {sortOperator === 'between' && (
                            <label className="field grow">
                              <span>{t('secondValue')}</span>
                              <input value={sortSecondValue} onChange={(event) => setSortSecondValue(event.target.value)} />
                            </label>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div className="filters-heading">
                    <div><FilterIcon /> <strong>{t('filters')}</strong> <span>{t('filtersAfterRead')}</span></div>
                    <button className="text-button" onClick={addFilter} disabled={filters.length >= 8}>{t('addFilter')}</button>
                  </div>
                  {filters.length > 0 && (
                    <div className="filter-list">
                      {filters.map((filter) => (
                        <FilterRow key={filter.id} filter={filter} attributes={attributeOptions} t={t} onChange={(patch) => updateFilter(filter.id, patch)} onRemove={() => setFilters((current) => current.filter((entry) => entry.id !== filter.id))} />
                      ))}
                    </div>
                  )}
                  <div className="query-footer">
                    <span className="query-note">
                      {mode === 'scan' ? t('scanCapacityWarning') : t('queryRequires', { name: selectedIndex.partitionKey.name })}
                    </span>
                    <button className="primary-button" onClick={() => void runExplore(undefined, true)} disabled={loadingData || filters.some((filter) => !filter.path) || (mode === 'query' && !partitionValue)}>
                      {loadingData ? <Spinner /> : <PlayIcon />} {t('execute', { mode: mode === 'scan' ? 'Scan' : 'Query' })}
                    </button>
                  </div>
                </section>
              )}

              {error && <div className="alert error"><WarningIcon /><span>{localizeError(error, locale)}</span><button onClick={() => setError('')}>×</button></div>}
              {notice && <div className="alert success"><CheckIcon /><span>{t(notice)}</span><button onClick={() => setNotice('')}>×</button></div>}

              <section className="data-card">
                <div className="result-summary">
                  <div className={`operation-badge ${result?.mode ?? mode}`}>{(result?.mode ?? mode).toUpperCase()}</div>
                  {result && (
                    <>
                      <strong>{t('returned', { count: result.count })}</strong>
                      <span>{t('evaluated', { count: result.scannedCount })}</span>
                      <span>{result.capacityUnits === undefined ? 'RCU —' : t('units', { count: result.capacityUnits })}</span>
                      <span>{result.durationMs} ms</span>
                    </>
                  )}
                </div>
                <div className="grid-wrap">
                  {loadingData && !result && <DataSkeleton />}
                  {!loadingData && result?.items.length === 0 && <div className="no-results"><SearchIcon /><strong>{t('noResults')}</strong><span>{t('noResultsHelp')}</span></div>}
                  {result && result.items.length > 0 && (
                    <table className="data-grid">
                      <thead>
                        <tr>
                          {columns.map((column) => {
                            const activeSort = sortColumn === column
                            return (
                              <th key={column} aria-sort={activeSort ? sortDirection : 'none'}>
                                <button
                                  className={`column-sort-button${activeSort ? ' active' : ''}`}
                                  onClick={() => toggleColumnSort(column)}
                                  title={t('sortBy', { column, direction: t(activeSort && sortDirection === 'ascending' ? 'descending' : 'ascending') })}
                                >
                                  <span>{column}</span>
                                  {isKeyColumn(column, schema) && <KeyIcon />}
                                  <span className="sort-indicator" aria-hidden="true">{activeSort ? (sortDirection === 'ascending' ? '↑' : '↓') : '↕'}</span>
                                </button>
                              </th>
                            )
                          })}
                          <th className="action-column" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedItems.map((item, rowIndex) => (
                          <tr key={rowIdentity(item, schema, rowIndex)}>
                            {columns.map((column) => <ValueCell key={column} value={item[column]} t={t} />)}
                            <td className="action-column"><button className="delete-button" onClick={() => requestDelete(item)} title={t('deleteRecord')}><TrashIcon /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="pagination-bar">
                  <span>{t('page', { number: cursorHistory.length + 1 })}</span>
                  <div>
                    <button className="secondary-button" onClick={() => void previousPage()} disabled={loadingData || cursorHistory.length === 0}>← {t('previous')}</button>
                    <button className="secondary-button" onClick={() => void nextPage()} disabled={loadingData || !result?.lastEvaluatedKey}>{t('next')} →</button>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {deleteCandidate && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !deleting && setDeleteCandidate(undefined)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="danger-icon"><TrashIcon /></div>
            <h2 id="delete-title">{t('deleteRecord')}</h2>
            <p>{t('deleteDescription')}</p>
            {isProduction && <div className="production-warning"><WarningIcon /> {t('productionWarning')}</div>}
            <dl className="delete-context">
              <div><dt>{t('profile')}</dt><dd>{profile}</dd></div>
              <div><dt>{t('region')}</dt><dd>{region}</dd></div>
              <div><dt>{t('table')}</dt><dd>{selectedTable}</dd></div>
            </dl>
            <div className="key-preview">
              <span>{t('primaryKey')}</span>
              <pre>{JSON.stringify(simpleDynamoItem(deleteCandidate.key), null, 2)}</pre>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" disabled={deleting} onClick={() => setDeleteCandidate(undefined)}>{t('cancel')}</button>
              <button className="danger-button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? <Spinner /> : <TrashIcon />} {t('deletePermanently')}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function FilterRow({ filter, attributes, t, onChange, onRemove }: { filter: UiFilter; attributes: AttributeOption[]; t: Translate; onChange: (patch: Partial<UiFilter>) => void; onRemove: () => void }): React.JSX.Element {
  const noValue = filter.operator === 'exists' || filter.operator === 'notExists'
  return (
    <div className="filter-row">
      <select
        className="filter-path"
        aria-label={t('filterField')}
        value={filter.path}
        onChange={(event) => {
          const selected = attributes.find((attribute) => attribute.path === event.target.value)
          onChange({
            path: event.target.value,
            ...(selected?.valueType ? { valueType: selected.valueType, value: selected.valueType === 'boolean' ? false : '' } : {}),
          })
        }}
      >
        <option value="" disabled>{t('selectField')}</option>
        {attributes.map((attribute) => <option key={attribute.path} value={attribute.path}>{attribute.path}</option>)}
      </select>
      <select aria-label={t('type')} value={filter.valueType} onChange={(event) => onChange({ valueType: event.target.value as ScalarInputType, value: event.target.value === 'boolean' ? false : '' })}>
        <option value="string">{t('text')}</option><option value="number">{t('number')}</option><option value="boolean">{t('boolean')}</option><option value="binary">Base64</option><option value="null">Null</option>
      </select>
      <select aria-label={t('operator')} value={filter.operator} onChange={(event) => onChange({ operator: event.target.value as FilterOperator })}>
        <option value="eq">{t('equals')}</option><option value="ne">{t('notEquals')}</option><option value="contains">{t('contains')}</option><option value="beginsWith">{t('beginsWith')}</option><option value="between">{t('isBetween')}</option><option value="lt">{t('lessThan')}</option><option value="lte">{t('lessThanOrEqual')}</option><option value="gt">{t('greaterThan')}</option><option value="gte">{t('greaterThanOrEqual')}</option><option value="exists">{t('exists')}</option><option value="notExists">{t('notExists')}</option>
      </select>
      {!noValue && filter.valueType === 'boolean' ? (
        <select aria-label={t('value')} value={String(filter.value)} onChange={(event) => onChange({ value: event.target.value === 'true' })}><option value="false">false</option><option value="true">true</option></select>
      ) : !noValue && filter.valueType !== 'null' ? (
        <input aria-label={t('value')} placeholder={t('value')} value={String(filter.value ?? '')} onChange={(event) => onChange({ value: event.target.value })} />
      ) : <span className="filter-spacer" />}
      {filter.operator === 'between' && <input aria-label={t('secondValue')} placeholder={t('secondValue')} value={String(filter.secondValue ?? '')} onChange={(event) => onChange({ secondValue: event.target.value })} />}
      <button className="remove-filter" onClick={onRemove} aria-label={t('removeFilter')}>×</button>
    </div>
  )
}

function discoverAttributeOptions(tableSchema: TableSchema | undefined, items: DynamoItem[]): AttributeOption[] {
  const discovered = new Map<string, ScalarInputType | undefined>()
  const tableIndex = tableSchema?.indexes.find((index) => index.kind === 'TABLE')
  const keys = [tableIndex?.partitionKey, tableIndex?.sortKey].filter(Boolean) as Array<NonNullable<typeof tableIndex>['partitionKey']>

  for (const key of keys) discovered.set(key.name, key.type === 'S' ? 'string' : key.type === 'N' ? 'number' : 'binary')
  for (const item of items) {
    for (const [name, value] of Object.entries(item)) collectAttributePaths(name, value, discovered)
  }

  const keyNames = keys.map((key) => key.name)
  return [
    ...keyNames.map((path) => ({ path, valueType: discovered.get(path) })),
    ...[...discovered.entries()]
      .filter(([path]) => !keyNames.includes(path))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, valueType]) => ({ path, valueType })),
  ]
}

function collectAttributePaths(path: string, value: DynamoValue, target: Map<string, ScalarInputType | undefined>): void {
  if (!target.has(path)) target.set(path, scalarInputType(value))
  if (value.type === 'map') {
    for (const [name, nestedValue] of Object.entries(value.value)) {
      collectAttributePaths(`${path}.${name}`, nestedValue, target)
    }
  }
}

function scalarInputType(value: DynamoValue): ScalarInputType | undefined {
  if (value.type === 'string' || value.type === 'number' || value.type === 'boolean' || value.type === 'binary' || value.type === 'null') return value.type
  return undefined
}

function mergeAttributeOptions(current: AttributeOption[], discovered: AttributeOption[]): AttributeOption[] {
  const merged = new Map(current.map((attribute) => [attribute.path, attribute.valueType]))
  for (const attribute of discovered) {
    if (!merged.has(attribute.path) || merged.get(attribute.path) === undefined) merged.set(attribute.path, attribute.valueType)
  }
  return [...merged.entries()].map(([path, valueType]) => ({ path, valueType }))
}

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function ValueCell({ value, t }: { value?: DynamoValue; t: Translate }): React.JSX.Element {
  if (!value) return <td className="empty-cell">—</td>
  const display = displayDynamoValue(value, t)
  return <td title={display.full}><span className={`type-dot ${value.type}`} />{display.short}</td>
}

function displayDynamoValue(value: DynamoValue, t?: Translate): { short: string; full: string } {
  let full: string
  switch (value.type) {
    case 'null': full = 'null'; break
    case 'boolean': full = String(value.value); break
    case 'string': case 'number': full = value.value; break
    case 'binary': full = t ? t('binaryValue', { count: value.value.length }) : `<binary · ${value.value.length} characters>`; break
    case 'stringSet': case 'numberSet': full = JSON.stringify(value.value); break
    case 'binarySet': full = t ? t('binarySet', { count: value.value.length }) : `<binary set · ${value.value.length} values>`; break
    case 'list': full = JSON.stringify(value.value.map(simpleDynamoValue)); break
    case 'map': full = JSON.stringify(simpleDynamoItem(value.value)); break
  }
  return { short: full.length > 72 ? `${full.slice(0, 69)}…` : full, full }
}

function simpleDynamoItem(item: DynamoItem): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).map(([name, value]) => [name, simpleDynamoValue(value)]))
}

function simpleDynamoValue(value: DynamoValue): unknown {
  switch (value.type) {
    case 'null': return null
    case 'string': case 'number': case 'boolean': case 'binary': return value.value
    case 'stringSet': case 'numberSet': case 'binarySet': return value.value
    case 'list': return value.value.map(simpleDynamoValue)
    case 'map': return simpleDynamoItem(value.value)
  }
}

function typedKeyInput(type: 'S' | 'N' | 'B', value: string): TypedInput {
  return { type: type === 'S' ? 'string' : type === 'N' ? 'number' : 'binary', value }
}

function isKeyColumn(name: string, schema?: TableSchema): boolean {
  const table = schema?.indexes.find((index) => index.kind === 'TABLE')
  return name === table?.partitionKey.name || name === table?.sortKey?.name
}

function rowIdentity(item: DynamoItem, schema: TableSchema | undefined, fallback: number): string {
  const table = schema?.indexes.find((index) => index.kind === 'TABLE')
  const keys = [table?.partitionKey.name, table?.sortKey?.name].filter(Boolean) as string[]
  return keys.length ? keys.map((name) => displayDynamoValue(item[name]).full).join('\0') : String(fallback)
}

function formatInteger(value: number | undefined, locale: Locale): string { return value === undefined ? '—' : new Intl.NumberFormat(locale === 'es' ? 'es-MX' : 'en-US').format(value) }
function formatBytes(value?: number): string {
  if (value === undefined) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
}

function EmptyState({ hasProfiles, t }: { hasProfiles: boolean; t: Translate }): React.JSX.Element {
  return <div className="empty-state"><div className="empty-illustration"><DatabaseIcon /></div><div className="eyebrow">DYNAMO EXPLORER</div><h1>{t(hasProfiles ? 'selectTable' : 'configureFirstProfile')}</h1><p>{t(hasProfiles ? 'selectTableHelp' : 'profileHelp')}</p></div>
}
function SidebarSkeleton(): React.JSX.Element { return <div className="skeleton-list">{[1,2,3,4,5,6].map((value) => <span key={value} />)}</div> }
function DataSkeleton(): React.JSX.Element { return <div className="data-skeleton">{[1,2,3,4,5].map((value) => <span key={value} />)}</div> }

type IconProps = { spinning?: boolean }
function RefreshIcon({ spinning }: IconProps): React.JSX.Element { return <svg className={spinning ? 'spin' : ''} viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" /></svg> }
function SearchIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg> }
function TableIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/></svg> }
function DatabaseIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg> }
function ShieldIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-5"/></svg> }
function FilterIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/></svg> }
function KeyIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="4"/><path d="M12 12h8m-3 0v3m-3-3v2"/></svg> }
function TrashIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg> }
function PlayIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg> }
function WarningIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v.01"/></svg> }
function CheckIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg> }
function Spinner(): React.JSX.Element { return <span className="spinner" /> }
