import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import './App.css'

type AniStatus = 'RELEASING' | 'FINISHED' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS'
type UserStatus = 'watching' | 'planning' | 'completed' | 'paused' | 'dropped'
type SubtitlePreference = 'hebrew' | 'english' | 'any'

type AniTitle = {
  romaji?: string | null
  english?: string | null
  native?: string | null
}

type ExternalLink = {
  site: string
  url: string
  type?: string | null
}

type AniMedia = {
  id: number
  title: AniTitle
  description?: string | null
  status: AniStatus
  episodes?: number | null
  popularity?: number | null
  trending?: number | null
  averageScore?: number | null
  coverImage?: { large?: string | null } | null
  bannerImage?: string | null
  nextAiringEpisode?: {
    airingAt: number
    timeUntilAiring: number
    episode: number
  } | null
  externalLinks?: ExternalLink[] | null
}

type TrackedShow = AniMedia & {
  titleHebrew?: string
  userEpisode: number
  userStatus: UserStatus
  subtitlePreference: SubtitlePreference
  hebrewSourceUrl?: string
  notes?: string
  updatedAt: string
}

type WeeklyScheduleItem = {
  id: number
  episode: number
  airingAt: number
  media: AniMedia
}

type WatchLink = {
  label: string
  url: string
  service: string
  primary?: boolean
}

type FreeSource = {
  service: string
  buildUrl: (title: string, episode?: number) => string
}

type CustomSource = {
  id: string
  name: string
  urlTemplate: string
  noSignup: boolean
  free: boolean
}

type TrendingWindow = 'day' | 'week' | 'month'

const STORAGE_KEY = 'anime-watchtower.watchlist.v1'
const SOURCES_STORAGE_KEY = 'anime-watchtower.custom-sources.v1'
const ANILIST_ENDPOINT = 'https://graphql.anilist.co'
const TIMEZONE = 'Asia/Jerusalem'
const BOOT_NOW = Date.now()

const statusLabels: Record<AniStatus, string> = {
  RELEASING: 'משודרת עכשיו',
  FINISHED: 'הסתיימה',
  NOT_YET_RELEASED: 'עוד לא יצאה',
  CANCELLED: 'בוטלה',
  HIATUS: 'בהפסקה',
}

const userStatusLabels: Record<UserStatus, string> = {
  watching: 'רואה עכשיו',
  planning: 'בתכנון',
  completed: 'סיימתי',
  paused: 'בהפסקה',
  dropped: 'עזבתי',
}

const subtitleLabels: Record<SubtitlePreference, string> = {
  hebrew: 'עדיפות לעברית',
  english: 'אנגלית בסדר',
  any: 'לא משנה',
}

const sampleSearches = ['One Piece', 'Solo Leveling', 'Jujutsu Kaisen', 'Frieren']

const trendingWindowLabels: Record<TrendingWindow, { label: string; helper: string; sort: string; source: string }> = {
  day: {
    label: 'היום',
    helper: 'מה שחם עכשיו ברשת לפי מדד Trending של AniList',
    sort: 'TRENDING_DESC',
    source: 'AniList Trending',
  },
  week: {
    label: 'השבוע',
    helper: 'סדרות משודרות עם הכי הרבה עוקבים/צופים רשומים',
    sort: 'POPULARITY_DESC',
    source: 'AniList Popularity',
  },
  month: {
    label: 'החודש',
    helper: 'הלהיטים החזקים של התקופה לפי דירוג + פופולריות',
    sort: 'SCORE_DESC',
    source: 'AniList Score + Popularity',
  },
}

const freeNoSignupSources: FreeSource[] = [
  {
    service: 'YouTube רשמי',
    buildUrl: (title, episode) =>
      `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} episode ${episode || ''} official full episode anime`)}`,
  },
  {
    service: 'Tubi',
    buildUrl: (title) => `https://tubitv.com/search/${encodeURIComponent(title)}`,
  },
  {
    service: 'Pluto TV',
    buildUrl: (title) => `https://pluto.tv/search/details?q=${encodeURIComponent(title)}`,
  },
  {
    service: 'Plex Free',
    buildUrl: (title) => `https://watch.plex.tv/search?q=${encodeURIComponent(title)}`,
  },
  {
    service: 'RetroCrush',
    buildUrl: (title) => `https://www.retrocrush.tv/search?q=${encodeURIComponent(title)}`,
  },
]

async function anilistRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`AniList החזיר שגיאה ${response.status}`)
  }

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join(', '))
  }

  if (!payload.data) {
    throw new Error('לא התקבלו נתונים מ-AniList')
  }

  return payload.data
}

const mediaFields = `
  id
  title { romaji english native }
  description(asHtml: false)
  status
  episodes
  popularity
  trending
  averageScore
  coverImage { large }
  bannerImage
  nextAiringEpisode { airingAt timeUntilAiring episode }
  externalLinks { site url type }
`

async function searchAnime(search: string): Promise<AniMedia[]> {
  const query = `
    query SearchAnime($search: String) {
      Page(page: 1, perPage: 10) {
        media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
          ${mediaFields}
        }
      }
    }
  `
  const data = await anilistRequest<{ Page: { media: AniMedia[] } }>(query, { search })
  return data.Page.media
}

async function refreshShows(ids: number[]): Promise<AniMedia[]> {
  if (!ids.length) return []
  const query = `
    query RefreshShows($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: ANIME, sort: ID) {
          ${mediaFields}
        }
      }
    }
  `
  const data = await anilistRequest<{ Page: { media: AniMedia[] } }>(query, { ids })
  return data.Page.media
}

async function fetchWeeklySchedule(ids: number[]): Promise<WeeklyScheduleItem[]> {
  if (!ids.length) return []
  const now = Math.floor(Date.now() / 1000)
  const sevenDays = now + 7 * 24 * 60 * 60
  const query = `
    query WeeklySchedule($ids: [Int], $from: Int, $to: Int) {
      Page(page: 1, perPage: 50) {
        airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          id
          episode
          airingAt
          media {
            ${mediaFields}
          }
        }
      }
    }
  `
  const data = await anilistRequest<{ Page: { airingSchedules: WeeklyScheduleItem[] } }>(query, {
    ids,
    from: now,
    to: sevenDays,
  })
  return data.Page.airingSchedules
}

async function fetchTrendingAnime(window: TrendingWindow): Promise<AniMedia[]> {
  const config = trendingWindowLabels[window]
  const query = `
    query TrendingAnime($sort: [MediaSort], $minPopularity: Int) {
      Page(page: 1, perPage: 12) {
        media(
          type: ANIME
          sort: $sort
          status_in: [RELEASING, FINISHED, NOT_YET_RELEASED]
          popularity_greater: $minPopularity
          isAdult: false
        ) {
          ${mediaFields}
        }
      }
    }
  `
  const data = await anilistRequest<{ Page: { media: AniMedia[] } }>(query, {
    sort: [config.sort],
    minPopularity: window === 'month' ? 15_000 : 1_000,
  })
  return data.Page.media
}


function getTitle(show: Pick<TrackedShow | AniMedia, 'title'> & { titleHebrew?: string }) {
  return show.titleHebrew || show.title.english || show.title.romaji || show.title.native || 'ללא שם'
}

function stripHtml(text?: string | null) {
  if (!text) return ''
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function normalizeUrl(url?: string) {
  const trimmed = url?.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function createLocalId() {
  return globalThis.crypto?.randomUUID?.() ?? `source-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function buildCustomSourceUrl(source: CustomSource, title: string, episode?: number) {
  const encodedTitle = encodeURIComponent(title)
  const encodedEpisode = encodeURIComponent(String(episode || ''))
  const fallbackQuery = encodeURIComponent(`${title} ${episode ? `episode ${episode}` : ''}`.trim())
  const template = source.urlTemplate.trim()

  if (!template) return ''

  const withTokens = template
    .replaceAll('{title}', encodedTitle)
    .replaceAll('{query}', fallbackQuery)
    .replaceAll('{episode}', encodedEpisode)

  return normalizeUrl(withTokens)
}

function getStreamingLinks(media: AniMedia) {
  return (media.externalLinks || []).filter((link) => link.type === 'STREAMING' && link.url)
}

function getEpisodeWatchLinks(
  media: AniMedia,
  trackedShow?: TrackedShow,
  episode?: number,
  customSources: CustomSource[] = [],
): WatchLink[] {
  const episodeText = episode ? `פרק ${episode}` : 'הפרק'
  const title = getTitle(trackedShow || media)
  const links: WatchLink[] = []
  const hebrewUrl = normalizeUrl(trackedShow?.hebrewSourceUrl)

  if (hebrewUrl) {
    links.push({
      label: `צפה ב${episodeText} במקור עברי`,
      service: 'מקור עברי',
      url: hebrewUrl,
      primary: true,
    })
  }

  customSources
    .filter((source) => source.name.trim() && source.urlTemplate.trim())
    .forEach((source) => {
      const badges = [source.free ? 'חינמי' : '', source.noSignup ? 'ללא רישום' : '']
        .filter(Boolean)
        .join(' · ')
      links.push({
        label: `פתח את ${episodeText} ב-${source.name}${badges ? ` — ${badges}` : ''}`,
        service: source.name,
        url: buildCustomSourceUrl(source, title, episode),
        primary: !hebrewUrl,
      })
    })

  freeNoSignupSources.slice(0, hebrewUrl || customSources.length ? 2 : 4).forEach((source) => {
    links.push({
      label: `חפש את ${episodeText} ב-${source.service} — חינמי/ללא רישום כשזמין באזור שלך`,
      service: source.service,
      url: source.buildUrl(title, episode),
    })
  })

  getStreamingLinks(media)
    .filter((link) => /youtube/i.test(link.site))
    .slice(0, 1)
    .forEach((link) => {
      links.push({
        label: `פתח מקור רשמי חינמי ל${episodeText} ב-${link.site}`,
        service: link.site,
        url: normalizeUrl(link.url),
      })
    })

  return links.filter((link) => link.url)
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp * 1000)
}

function formatCountdown(timestamp?: number) {
  if (!timestamp) return 'אין תאריך לפרק הבא'
  const diff = timestamp * 1000 - Date.now()
  const abs = Math.abs(diff)
  const days = Math.floor(abs / 86_400_000)
  const hours = Math.floor((abs % 86_400_000) / 3_600_000)
  const minutes = Math.floor((abs % 3_600_000) / 60_000)
  const parts = [
    days ? `${days} ימים` : '',
    hours ? `${hours} שעות` : '',
    !days && minutes ? `${minutes} דקות` : '',
  ].filter(Boolean)

  const phrase = parts.length ? parts.join(' ו') : 'פחות מדקה'
  return diff >= 0 ? `בעוד ${phrase}` : `שודר לפני ${phrase}`
}

function loadWatchlist(): TrackedShow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as TrackedShow[]
  } catch {
    return []
  }
}

function loadCustomSources(): CustomSource[] {
  try {
    const raw = localStorage.getItem(SOURCES_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as CustomSource[]
  } catch {
    return []
  }
}

function createTrackedShow(media: AniMedia): TrackedShow {
  return {
    ...media,
    userEpisode: Math.max(0, (media.nextAiringEpisode?.episode || 1) - 1),
    userStatus: media.status === 'FINISHED' ? 'planning' : 'watching',
    subtitlePreference: 'hebrew',
    updatedAt: new Date().toISOString(),
  }
}

function App() {
  const [watchlist, setWatchlist] = useState<TrackedShow[]>(() => loadWatchlist())
  const [customSources, setCustomSources] = useState<CustomSource[]>(() => loadCustomSources())
  const [sourceName, setSourceName] = useState('')
  const [sourceTemplate, setSourceTemplate] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<AniMedia[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleItem[]>([])
  const [trendingWindow, setTrendingWindow] = useState<TrendingWindow>('day')
  const [trendingAnime, setTrendingAnime] = useState<AniMedia[]>([])
  const [isTrendingLoading, setIsTrendingLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(BOOT_NOW)

  const watchlistIds = useMemo(() => watchlist.map((show) => show.id).join(','), [watchlist])
  const activeTrendingConfig = trendingWindowLabels[trendingWindow]

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist))
  }, [watchlist])

  useEffect(() => {
    localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(customSources))
  }, [customSources])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchTrendingAnime(trendingWindow)
      .then((items) => {
        if (!cancelled) setTrendingAnime(items)
      })
      .catch((err) => {
        if (!cancelled) {
          setTrendingAnime([])
          setError(err instanceof Error ? err.message : 'טעינת הכי נצפים נכשלה')
        }
      })
      .finally(() => {
        if (!cancelled) setIsTrendingLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [trendingWindow])

  useEffect(() => {
    const ids = watchlistIds
      .split(',')
      .filter(Boolean)
      .map((id) => Number(id))
    fetchWeeklySchedule(ids)
      .then(setWeeklySchedule)
      .catch(() => setWeeklySchedule([]))
  }, [watchlistIds])

  const sortedWatchlist = useMemo(() => {
    // Depend on nowTick so countdown-heavy ordering can refresh as the minute changes.
    void nowTick
    return [...watchlist].sort((a, b) => {
      const aTime = a.nextAiringEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER
      const bTime = b.nextAiringEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER
      return aTime - bTime
    })
  }, [watchlist, nowTick])

  const stats = useMemo(() => {
    const airing = watchlist.filter((show) => show.status === 'RELEASING').length
    const waitingHebrew = watchlist.filter(
      (show) => show.subtitlePreference === 'hebrew' && !show.hebrewSourceUrl,
    ).length
    const next = sortedWatchlist.find((show) => show.nextAiringEpisode)?.nextAiringEpisode
    return { total: watchlist.length, airing, waitingHebrew, next }
  }, [watchlist, sortedWatchlist])

  async function handleSearch(term = searchTerm) {
    const normalized = term.trim()
    if (!normalized) return
    setIsSearching(true)
    setError(null)
    try {
      setSearchResults(await searchAnime(normalized))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'החיפוש נכשל')
    } finally {
      setIsSearching(false)
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    setError(null)
    try {
      const fresh = await refreshShows(watchlist.map((show) => show.id))
      setWatchlist((current) =>
        current.map((show) => {
          const freshShow = fresh.find((item) => item.id === show.id)
          return freshShow ? { ...show, ...freshShow, updatedAt: new Date().toISOString() } : show
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'הרענון נכשל')
    } finally {
      setIsRefreshing(false)
    }
  }

  function addShow(media: AniMedia) {
    setWatchlist((current) => {
      if (current.some((show) => show.id === media.id)) return current
      return [createTrackedShow(media), ...current]
    })
  }

  function updateShow(id: number, patch: Partial<TrackedShow>) {
    setWatchlist((current) =>
      current.map((show) =>
        show.id === id ? { ...show, ...patch, updatedAt: new Date().toISOString() } : show,
      ),
    )
  }

  function removeShow(id: number) {
    setWatchlist((current) => current.filter((show) => show.id !== id))
  }

  function addCustomSource() {
    const name = sourceName.trim()
    const urlTemplate = sourceTemplate.trim()
    if (!name || !urlTemplate) return

    setCustomSources((current) => [
      ...current,
      {
        id: createLocalId(),
        name,
        urlTemplate,
        free: true,
        noSignup: true,
      },
    ])
    setSourceName('')
    setSourceTemplate('')
  }

  function removeCustomSource(id: string) {
    setCustomSources((current) => current.filter((source) => source.id !== id))
  }

  return (
    <main className="app-shell" dir="rtl">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow">
            <Sparkles size={18} /> מגדל השמירה לאנימה שלך
          </div>
          <h1>דשבורד סדרות אנימה עם ספירה חיה לפרק הבא</h1>
          <p>
            חפש סדרות דרך AniList, הוסף למעקב, סמן עד איזה פרק ראית, שמור מקור עברי ידני
            וקבל לוח שבועי לפי שעון ישראל עם מקורות חינמיים וחוקיים כשזמינים.
          </p>
          <div className="hero-actions">
            <form
              className="search-box"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSearch()
              }}
            >
              <Search size={20} />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="חפש: One Piece, Solo Leveling..."
              />
              <button type="submit" disabled={isSearching}>
                {isSearching ? <Loader2 className="spin" size={18} /> : 'חפש'}
              </button>
            </form>
            <button className="secondary-button" type="button" onClick={handleRefresh} disabled={!watchlist.length || isRefreshing}>
              {isRefreshing ? <Loader2 className="spin" size={18} /> : <Clock3 size={18} />}
              רענן מעקב
            </button>
          </div>
          <div className="quick-searches">
            {sampleSearches.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setSearchTerm(item)
                  void handleSearch(item)
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="stats-grid" aria-label="סטטיסטיקות">
          <div>
            <strong>{stats.total}</strong>
            <span>סדרות במעקב</span>
          </div>
          <div>
            <strong>{stats.airing}</strong>
            <span>משודרות עכשיו</span>
          </div>
          <div>
            <strong>{stats.waitingHebrew}</strong>
            <span>מחכות למקור עברי</span>
          </div>
          <div>
            <strong>{stats.next ? formatCountdown(stats.next.airingAt) : 'אין עדיין'}</strong>
            <span>הפרק הבא הקרוב</span>
          </div>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="panel trending-panel">
        <div className="section-heading">
          <div>
            <h2>הכי נצפים עכשיו</h2>
            <span>{activeTrendingConfig.helper} · מקור: {activeTrendingConfig.source}</span>
          </div>
          <div className="trending-filters" role="tablist" aria-label="סינון הכי נצפים">
            {(Object.keys(trendingWindowLabels) as TrendingWindow[]).map((window) => (
              <button
                type="button"
                key={window}
                className={trendingWindow === window ? 'active' : undefined}
                onClick={() => {
                  if (trendingWindow !== window) setIsTrendingLoading(true)
                  setTrendingWindow(window)
                }}
              >
                {trendingWindowLabels[window].label}
              </button>
            ))}
          </div>
        </div>
        {isTrendingLoading ? (
          <div className="trending-loading"><Loader2 className="spin" size={20} /> טוען נתוני רשת...</div>
        ) : (
          <div className="trending-grid">
            {trendingAnime.map((media, index) => {
              const exists = watchlist.some((show) => show.id === media.id)
              return (
                <article className="trending-card" key={`${trendingWindow}-${media.id}`}>
                  <div className="rank-badge">#{index + 1}</div>
                  <img src={media.coverImage?.large || ''} alt="" />
                  <div className="trending-card-body">
                    <h3>{getTitle(media)}</h3>
                    <div className="trend-metrics">
                      {typeof media.trending === 'number' && <span>🔥 {media.trending.toLocaleString('he-IL')} טרנד</span>}
                      {typeof media.popularity === 'number' && <span>👥 {media.popularity.toLocaleString('he-IL')} עוקבים</span>}
                      {typeof media.averageScore === 'number' && <span>⭐ {media.averageScore}%</span>}
                    </div>
                    <small>{media.nextAiringEpisode ? `פרק ${media.nextAiringEpisode.episode} ${formatCountdown(media.nextAiringEpisode.airingAt)}` : statusLabels[media.status]}</small>
                    <button type="button" onClick={() => addShow(media)} disabled={exists}>
                      {exists ? <Check size={16} /> : <Plus size={16} />}
                      {exists ? 'במעקב' : 'הוסף'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {searchResults.length > 0 && (
        <section className="panel">
          <div className="section-heading">
            <h2>תוצאות חיפוש</h2>
            <span>{searchResults.length} תוצאות מ-AniList</span>
          </div>
          <div className="results-grid">
            {searchResults.map((media) => {
              const exists = watchlist.some((show) => show.id === media.id)
              return (
                <article className="result-card" key={media.id}>
                  <img src={media.coverImage?.large || ''} alt="" />
                  <div>
                    <h3>{getTitle(media)}</h3>
                    <p>{stripHtml(media.description).slice(0, 130)}...</p>
                    <div className="mini-meta">
                      <span>{statusLabels[media.status]}</span>
                      {media.nextAiringEpisode && <span>פרק {media.nextAiringEpisode.episode} {formatCountdown(media.nextAiringEpisode.airingAt)}</span>}
                    </div>
                    <button type="button" onClick={() => addShow(media)} disabled={exists}>
                      {exists ? <Check size={18} /> : <Plus size={18} />}
                      {exists ? 'כבר במעקב' : 'הוסף למעקב'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <section className="panel sources-panel">
        <div className="section-heading">
          <div>
            <h2>מקורות צפייה אישיים</h2>
            <span>הוסף מקורות שאתה רוצה שיופיעו לכל פרק. תומך ב־{'{title}'}, {'{episode}'} ו־{'{query}'} בכתובת.</span>
          </div>
        </div>
        <div className="source-builder">
          <label>
            שם המקור
            <input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder="למשל: המקור שלי"
            />
          </label>
          <label className="source-url-field">
            תבנית קישור
            <input
              value={sourceTemplate}
              onChange={(event) => setSourceTemplate(event.target.value)}
              placeholder="https://example.com/search?q={query}"
            />
          </label>
          <button type="button" onClick={addCustomSource} disabled={!sourceName.trim() || !sourceTemplate.trim()}>
            <Plus size={18} /> הוסף מקור
          </button>
        </div>
        <p className="source-help">
          דוגמאות: <code>https://site.com/search?q={'{query}'}</code> או <code>https://site.com/anime/{'{title}'}/episode-{'{episode}'}</code>
        </p>
        {customSources.length > 0 && (
          <div className="custom-source-list">
            {customSources.map((source) => (
              <div className="custom-source-item" key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  <small>{source.urlTemplate}</small>
                  <span>חינמי · ללא רישום · אישי</span>
                </div>
                <button type="button" onClick={() => removeCustomSource(source.id)} aria-label={`הסר ${source.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="dashboard-layout">
        <div className="panel watchlist-panel">
          <div className="section-heading">
            <h2>הסדרות שלי</h2>
            <span>מעקב אישי + מקורות חינמיים/ידניים</span>
          </div>

          {sortedWatchlist.length === 0 ? (
            <div className="empty-state">
              <CalendarDays size={44} />
              <h3>עדיין אין סדרות במעקב</h3>
              <p>חפש סדרה למעלה והוסף אותה. ההתקדמות תישמר מקומית בדפדפן.</p>
            </div>
          ) : (
            <div className="show-list">
              {sortedWatchlist.map((show) => {
                const watchLinks = getEpisodeWatchLinks(show, show, show.nextAiringEpisode?.episode, customSources)
                return (
                  <article className="show-card" key={show.id}>
                    <div
                      className="show-banner"
                      style={{
                        backgroundImage: `linear-gradient(90deg, rgba(13,15,24,.98), rgba(13,15,24,.72)), url(${show.bannerImage || show.coverImage?.large || ''})`,
                      }}
                    >
                      <img src={show.coverImage?.large || ''} alt="" />
                      <div className="show-main">
                        <div className="status-row">
                          <span>{statusLabels[show.status]}</span>
                          <button type="button" className="icon-button danger" onClick={() => removeShow(show.id)} aria-label="הסר">
                            <Trash2 size={17} />
                          </button>
                        </div>
                        <h3>{getTitle(show)}</h3>
                        <p className="countdown">
                          {show.nextAiringEpisode
                            ? `פרק ${show.nextAiringEpisode.episode} ${formatCountdown(show.nextAiringEpisode.airingAt)}`
                            : show.status === 'FINISHED'
                              ? 'הסדרה הסתיימה'
                              : 'אין כרגע תאריך לפרק הבא'}
                        </p>
                        {show.nextAiringEpisode && <p className="airing-time">{formatDateTime(show.nextAiringEpisode.airingAt)} · שעון ישראל</p>}
                      </div>
                    </div>

                    <div className="show-controls">
                      <label>
                        ראיתי עד פרק
                        <div className="episode-stepper">
                          <button type="button" onClick={() => updateShow(show.id, { userEpisode: Math.max(0, show.userEpisode - 1) })}>−</button>
                          <input
                            type="number"
                            min="0"
                            value={show.userEpisode}
                            onChange={(event) => updateShow(show.id, { userEpisode: Number(event.target.value) || 0 })}
                          />
                          <button type="button" onClick={() => updateShow(show.id, { userEpisode: show.userEpisode + 1 })}>+</button>
                        </div>
                      </label>
                      <label>
                        סטטוס צפייה
                        <select value={show.userStatus} onChange={(event) => updateShow(show.id, { userStatus: event.target.value as UserStatus })}>
                          {Object.entries(userStatusLabels).map(([value, label]) => (
                            <option value={value} key={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        כתוביות
                        <select value={show.subtitlePreference} onChange={(event) => updateShow(show.id, { subtitlePreference: event.target.value as SubtitlePreference })}>
                          {Object.entries(subtitleLabels).map(([value, label]) => (
                            <option value={value} key={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        שם עברי ידני
                        <input
                          value={show.titleHebrew || ''}
                          onChange={(event) => updateShow(show.id, { titleHebrew: event.target.value })}
                          placeholder="למשל: וואן פיס"
                        />
                      </label>
                      <label className="wide">
                        מקור עברי / קישור צפייה חוקי / הערה
                        <input
                          value={show.hebrewSourceUrl || ''}
                          onChange={(event) => updateShow(show.id, { hebrewSourceUrl: event.target.value })}
                          placeholder="הדבק קישור או השאר ריק אם מחכה לתרגום"
                        />
                      </label>
                    </div>

                    <div className="links-row">
                      {watchLinks.length ? (
                        watchLinks.map((link) => (
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className={link.primary ? 'primary-link' : undefined}
                            key={`${show.id}-${link.service}-${link.url}`}
                            aria-label={link.label}
                            title={link.label}
                          >
                            {link.primary ? 'צפייה בפרק הבא' : link.service} <ExternalLink size={14} />
                          </a>
                        ))
                      ) : (
                        <span className="waiting-chip">אין עדיין לינק צפייה — הוסף מקור ידני</span>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        <aside className="panel calendar-panel">
          <div className="section-heading compact">
            <h2>השבוע הקרוב</h2>
            <span>לפי Asia/Jerusalem · חינמי/ללא רישום כשזמין</span>
          </div>
          {weeklySchedule.length === 0 ? (
            <div className="empty-small">אין פרקים מתוזמנים בשבוע הקרוב לסדרות שבחרת.</div>
          ) : (
            <div className="schedule-list">
              {weeklySchedule.map((item) => {
                const trackedShow = watchlist.find((show) => show.id === item.media.id)
                const episodeLinks = getEpisodeWatchLinks(item.media, trackedShow, item.episode, customSources)
                return (
                  <div className="schedule-item" key={item.id}>
                    <img src={item.media.coverImage?.large || ''} alt="" />
                    <div>
                      <strong>{getTitle(trackedShow || item.media)}</strong>
                      <span>פרק {item.episode}</span>
                      <small>{formatDateTime(item.airingAt)} · {formatCountdown(item.airingAt)}</small>
                      <div className="episode-watch-row">
                        {episodeLinks.length ? (
                          episodeLinks.map((link) => (
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              className={link.primary ? 'watch-link primary' : 'watch-link'}
                              key={`${item.id}-${link.service}-${link.url}`}
                              aria-label={link.label}
                              title={link.label}
                            >
                              {link.primary ? 'צפייה בעברית' : link.service}
                              <ExternalLink size={12} />
                            </a>
                          ))
                        ) : (
                          <em>אין לינק צפייה — הוסף מקור ידני בכרטיס הסדרה</em>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </aside>
      </section>
    </main>
  )
}

export default App
