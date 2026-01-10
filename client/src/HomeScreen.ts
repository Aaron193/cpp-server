import { isDevelopment } from './utils/environment'

interface GameServer {
    id: string
    host: string
    port: number
    region: string
    maxPlayers: number
    currentPlayers: number
    lastHeartbeat: string
    isOnline: boolean
}

interface ChangelogEntry {
    id: string
    version: string
    date: string
    tag: 'new' | 'fix' | 'update'
    changes: string[]
}

interface LeaderboardEntry {
    rank: number
    name: string
    score: number
    kills: number
    wins: number
    gamesPlayed: number
}

interface User {
    id: string
    username: string
    email: string | null
    createdAt: string
}

type LeaderboardPeriod = 'all' | 'weekly' | 'daily'

const API_BASE =
    // (process.env as any).CLIENT_API_BASE ||
    isDevelopment() ? 'http://localhost:3000' : window.location.origin + '/api'

export class HomeScreen {
    private container: HTMLElement
    private onServerSelect: (host: string, port: number) => void
    private refreshInterval: number | null = null
    private playerName: string = ''
    private servers: GameServer[] = []
    private currentUser: User | null = null
    private changelog: ChangelogEntry[] = []
    private leaderboard: LeaderboardEntry[] = []
    private currentLeaderboardPeriod: LeaderboardPeriod = 'all'

    constructor(
        containerId: string,
        onServerSelect: (host: string, port: number) => void
    ) {
        const element = document.getElementById(containerId)
        if (!element) {
            throw new Error(`Element with id '${containerId}' not found`)
        }
        this.container = element
        this.onServerSelect = onServerSelect

        // Load saved player name from localStorage
        this.playerName = localStorage.getItem('playerName') || ''

        this.setupUI()
        this.setupModalHandlers()
    }

    private setupUI(): void {
        this.container.innerHTML = `
            <div class="home-content">
                <!-- Header -->
                <header class="header">
                    <h1 class="game-title">Arena.io</h1>
                    <p class="game-subtitle">Battle Royale Multiplayer</p>
                </header>

                <!-- Player Identity Section -->
                <section class="player-section">
                    <div class="player-name-group">
                        <label class="input-label" for="player-name">Your Name</label>
                        <input 
                            type="text" 
                            id="player-name" 
                            class="player-name-input" 
                            placeholder="Enter your name..."
                            maxlength="16"
                            value="${this.escapeHtml(this.playerName)}"
                        />
                    </div>
                    <div class="auth-buttons" id="auth-buttons">
                        <!-- Auth buttons populated dynamically -->
                    </div>
                </section>

                <!-- Quick Play -->
                <section class="quick-play-section">
                    <button id="quick-play-btn" class="btn btn-success btn-lg quick-play-btn">
                        ▶ Quick Play
                    </button>
                </section>

                <!-- Navigation Tabs -->
                <nav class="nav-tabs">
                    <button id="leaderboard-btn" class="btn btn-ghost">
                        🏆 Leaderboard
                    </button>
                    <button id="changelog-btn" class="btn btn-ghost">
                        📜 Changelog
                    </button>
                </nav>

                <!-- Server List -->
                <section class="server-section">
                    <div class="section-header">
                        <h2 class="section-title">Servers</h2>
                        <button id="refresh-btn" class="btn btn-ghost">↻ Refresh</button>
                    </div>
                    <div id="server-list" class="server-list">
                        <div class="no-servers">
                            <p>Loading servers...</p>
                        </div>
                    </div>
                </section>

                <!-- Footer -->
                <footer class="home-footer">
                    <a href="#" class="footer-link">Discord</a>
                    <a href="#" class="footer-link">Twitter</a>
                    <a href="#" class="footer-link">GitHub</a>
                </footer>
            </div>
        `

        this.attachEventListeners()
        this.updateAuthUI()
    }

    private attachEventListeners(): void {
        // Player name input
        const nameInput = document.getElementById(
            'player-name'
        ) as HTMLInputElement
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                this.playerName = (e.target as HTMLInputElement).value
                localStorage.setItem('playerName', this.playerName)
            })
        }

        // Quick play button
        const quickPlayBtn = document.getElementById('quick-play-btn')
        if (quickPlayBtn) {
            quickPlayBtn.addEventListener('click', () => this.quickPlay())
        }

        // Refresh button
        const refreshBtn = document.getElementById('refresh-btn')
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.fetchServers())
        }

        // Modal buttons
        const leaderboardBtn = document.getElementById('leaderboard-btn')
        if (leaderboardBtn) {
            leaderboardBtn.addEventListener('click', () =>
                this.showLeaderboardModal()
            )
        }

        const changelogBtn = document.getElementById('changelog-btn')
        if (changelogBtn) {
            changelogBtn.addEventListener('click', () =>
                this.showChangelogModal()
            )
        }
    }

    private updateAuthUI(): void {
        const authButtons = document.getElementById('auth-buttons')
        if (!authButtons) return

        if (this.currentUser) {
            authButtons.innerHTML = `
                <span class="user-greeting">Welcome, <strong>${this.escapeHtml(this.currentUser.username)}</strong></span>
                <button id="logout-btn" class="btn btn-ghost">
                    Logout
                </button>
            `
            const logoutBtn = document.getElementById('logout-btn')
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => this.logout())
            }
        } else {
            authButtons.innerHTML = `
                <button id="login-btn" class="btn btn-secondary">
                    <span>🔐</span> Login
                </button>
            `
            const loginBtn = document.getElementById('login-btn')
            if (loginBtn) {
                loginBtn.addEventListener('click', () => this.showLoginModal())
            }
        }
    }

    private setupModalHandlers(): void {
        const overlay = document.getElementById('modal-overlay')
        const closeBtn = document.getElementById('modal-close')

        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.hideModal()
                }
            })
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideModal())
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideModal()
            }
        })
    }

    private showModal(content: string): void {
        const overlay = document.getElementById('modal-overlay')
        const container = document.getElementById('modal-content')

        if (overlay && container) {
            container.innerHTML = content
            overlay.classList.remove('hidden')
        }
    }

    private hideModal(): void {
        const overlay = document.getElementById('modal-overlay')
        if (overlay) {
            overlay.classList.add('hidden')
        }
    }

    private showLoginModal(): void {
        this.showModal(`
            <div class="modal-header">
                <h3 class="modal-title">Login</h3>
            </div>
            <div class="modal-body">
                <div id="login-error" class="form-error hidden"></div>
                <form class="login-form" id="login-form">
                    <div class="form-group">
                        <label class="input-label" for="login-username">Username or Email</label>
                        <input 
                            type="text" 
                            id="login-username" 
                            class="form-input" 
                            placeholder="Enter username or email..."
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label class="input-label" for="login-password">Password</label>
                        <input 
                            type="password" 
                            id="login-password" 
                            class="form-input" 
                            placeholder="Enter your password..."
                            required
                        />
                    </div>
                    <button type="submit" id="login-submit-btn" class="btn btn-primary" style="width: 100%;">
                        Login
                    </button>
                    <div class="form-divider">or</div>
                    <button type="button" id="guest-btn" class="btn btn-secondary" style="width: 100%;">
                        Continue as Guest
                    </button>
                </form>
                <div class="login-footer">
                    <p class="login-footer-text">
                        Don't have an account? <a href="#" id="show-register-link">Sign up</a>
                    </p>
                </div>
            </div>
        `)

        // Attach form handler
        const form = document.getElementById('login-form')
        if (form) {
            form.addEventListener('submit', (e) => this.handleLogin(e))
        }

        // Guest button
        const guestBtn = document.getElementById('guest-btn')
        if (guestBtn) {
            guestBtn.addEventListener('click', () => this.hideModal())
        }

        // Show register link
        const registerLink = document.getElementById('show-register-link')
        if (registerLink) {
            registerLink.addEventListener('click', (e) => {
                e.preventDefault()
                this.showRegisterModal()
            })
        }
    }

    private showRegisterModal(): void {
        this.showModal(`
            <div class="modal-header">
                <h3 class="modal-title">Create Account</h3>
            </div>
            <div class="modal-body">
                <div id="register-error" class="form-error hidden"></div>
                <form class="login-form" id="register-form">
                    <div class="form-group">
                        <label class="input-label" for="register-username">Username</label>
                        <input 
                            type="text" 
                            id="register-username" 
                            class="form-input" 
                            placeholder="Choose a username..."
                            minlength="3"
                            maxlength="20"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label class="input-label" for="register-email">Email (optional)</label>
                        <input 
                            type="email" 
                            id="register-email" 
                            class="form-input" 
                            placeholder="Enter your email..."
                        />
                    </div>
                    <div class="form-group">
                        <label class="input-label" for="register-password">Password</label>
                        <input 
                            type="password" 
                            id="register-password" 
                            class="form-input" 
                            placeholder="Choose a password..."
                            minlength="8"
                            required
                        />
                    </div>
                    <button type="submit" id="register-submit-btn" class="btn btn-primary" style="width: 100%;">
                        Create Account
                    </button>
                </form>
                <div class="login-footer">
                    <p class="login-footer-text">
                        Already have an account? <a href="#" id="show-login-link">Login</a>
                    </p>
                </div>
            </div>
        `)

        // Attach form handler
        const form = document.getElementById('register-form')
        if (form) {
            form.addEventListener('submit', (e) => this.handleRegister(e))
        }

        // Show login link
        const loginLink = document.getElementById('show-login-link')
        if (loginLink) {
            loginLink.addEventListener('click', (e) => {
                e.preventDefault()
                this.showLoginModal()
            })
        }
    }

    private async handleLogin(e: Event): Promise<void> {
        e.preventDefault()

        const usernameInput = document.getElementById(
            'login-username'
        ) as HTMLInputElement
        const passwordInput = document.getElementById(
            'login-password'
        ) as HTMLInputElement
        const submitBtn = document.getElementById(
            'login-submit-btn'
        ) as HTMLButtonElement
        const errorDiv = document.getElementById('login-error')

        if (!usernameInput || !passwordInput || !submitBtn) return

        const usernameOrEmail = usernameInput.value.trim()
        const password = passwordInput.value

        // Disable form while submitting
        submitBtn.disabled = true
        submitBtn.textContent = 'Logging in...'

        try {
            const response = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usernameOrEmail, password }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Login failed')
            }

            this.currentUser = data.user

            // Update player name to match username if not set
            if (!this.playerName && this.currentUser) {
                this.playerName = this.currentUser.username
                localStorage.setItem('playerName', this.playerName)
                const nameInput = document.getElementById(
                    'player-name'
                ) as HTMLInputElement
                if (nameInput) {
                    nameInput.value = this.playerName
                }
            }

            this.updateAuthUI()
            this.hideModal()
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Login failed'
            if (errorDiv) {
                errorDiv.textContent = message
                errorDiv.classList.remove('hidden')
            }
        } finally {
            submitBtn.disabled = false
            submitBtn.textContent = 'Login'
        }
    }

    private async handleRegister(e: Event): Promise<void> {
        e.preventDefault()

        const usernameInput = document.getElementById(
            'register-username'
        ) as HTMLInputElement
        const emailInput = document.getElementById(
            'register-email'
        ) as HTMLInputElement
        const passwordInput = document.getElementById(
            'register-password'
        ) as HTMLInputElement
        const submitBtn = document.getElementById(
            'register-submit-btn'
        ) as HTMLButtonElement
        const errorDiv = document.getElementById('register-error')

        if (!usernameInput || !passwordInput || !submitBtn) return

        const username = usernameInput.value.trim()
        const email = emailInput?.value.trim() || undefined
        const password = passwordInput.value

        // Disable form while submitting
        submitBtn.disabled = true
        submitBtn.textContent = 'Creating account...'

        try {
            const response = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Registration failed')
            }

            this.currentUser = data.user

            // Set player name to username
            this.playerName = username
            localStorage.setItem('playerName', this.playerName)
            const nameInput = document.getElementById(
                'player-name'
            ) as HTMLInputElement
            if (nameInput) {
                nameInput.value = this.playerName
            }

            this.updateAuthUI()
            this.hideModal()
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Registration failed'
            if (errorDiv) {
                errorDiv.textContent = message
                errorDiv.classList.remove('hidden')
            }
        } finally {
            submitBtn.disabled = false
            submitBtn.textContent = 'Create Account'
        }
    }

    private async logout(): Promise<void> {
        try {
            await fetch(`${API_BASE}/auth/logout`, { method: 'POST' })
        } catch (error) {
            console.error('Logout error:', error)
        }

        this.currentUser = null
        this.updateAuthUI()
    }

    private async checkAuthStatus(): Promise<void> {
        try {
            const response = await fetch(`${API_BASE}/auth/me`, {
                credentials: 'include',
            })
            if (response.ok) {
                const data = await response.json()
                this.currentUser = data.user
            }
        } catch (error) {
            // Not logged in, that's fine
            console.log('Not logged in')
        }
        this.updateAuthUI()
    }

    private async showLeaderboardModal(): Promise<void> {
        // Show loading state
        this.showModal(`
            <div class="modal-header">
                <h3 class="modal-title">Leaderboard</h3>
            </div>
            <div class="leaderboard-tabs">
                <button class="leaderboard-tab active" data-period="all">All Time</button>
                <button class="leaderboard-tab" data-period="weekly">Weekly</button>
                <button class="leaderboard-tab" data-period="daily">Daily</button>
            </div>
            <div class="modal-body">
                <div class="leaderboard-list" id="leaderboard-list">
                    <div class="loading-state">Loading leaderboard...</div>
                </div>
            </div>
        `)

        // Attach tab handlers
        const tabs = document.querySelectorAll('.leaderboard-tab')
        tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                tabs.forEach((t) => t.classList.remove('active'))
                tab.classList.add('active')
                const period = (tab as HTMLElement).dataset
                    .period as LeaderboardPeriod
                this.fetchLeaderboard(period)
            })
        })

        // Fetch initial data
        await this.fetchLeaderboard('all')
    }

    private async fetchLeaderboard(period: LeaderboardPeriod): Promise<void> {
        this.currentLeaderboardPeriod = period
        const listEl = document.getElementById('leaderboard-list')
        if (!listEl) return

        listEl.innerHTML = '<div class="loading-state">Loading...</div>'

        try {
            const response = await fetch(
                `${API_BASE}/leaderboard?period=${period}&limit=50`
            )

            if (!response.ok) {
                throw new Error('Failed to fetch leaderboard')
            }

            const data = await response.json()
            this.leaderboard = data.leaderboard || []
            this.renderLeaderboardList()
        } catch (error) {
            console.error('Error fetching leaderboard:', error)
            listEl.innerHTML = `
                <div class="error-message">
                    <p>Failed to load leaderboard. Please try again.</p>
                </div>
            `
        }
    }

    private renderLeaderboardList(): void {
        const listEl = document.getElementById('leaderboard-list')
        if (!listEl) return

        if (this.leaderboard.length === 0) {
            listEl.innerHTML = `
                <div class="no-servers">
                    <p>No leaderboard data available yet.</p>
                    <p style="font-size: 0.875rem; margin-top: 8px;">Play some games to get on the board!</p>
                </div>
            `
            return
        }

        listEl.innerHTML = this.leaderboard
            .map((entry) => this.renderLeaderboardEntry(entry))
            .join('')
    }

    private renderLeaderboardEntry(entry: LeaderboardEntry): string {
        let rankClass = ''
        if (entry.rank === 1) rankClass = 'gold'
        else if (entry.rank === 2) rankClass = 'silver'
        else if (entry.rank === 3) rankClass = 'bronze'

        return `
            <div class="leaderboard-entry">
                <div class="leaderboard-rank ${rankClass}">#${entry.rank}</div>
                <div class="leaderboard-player">
                    <span class="leaderboard-name">${this.escapeHtml(entry.name)}</span>
                    <span class="leaderboard-stats">${entry.kills} kills • ${entry.wins} wins</span>
                </div>
                <div class="leaderboard-score">${entry.score.toLocaleString()}</div>
            </div>
        `
    }

    private async showChangelogModal(): Promise<void> {
        // Show loading state
        this.showModal(`
            <div class="modal-header">
                <h3 class="modal-title">Changelog</h3>
            </div>
            <div class="modal-body">
                <div class="changelog-list" id="changelog-list">
                    <div class="loading-state">Loading changelog...</div>
                </div>
            </div>
        `)

        await this.fetchChangelog()
    }

    private async fetchChangelog(): Promise<void> {
        const listEl = document.getElementById('changelog-list')
        if (!listEl) return

        try {
            const response = await fetch(`${API_BASE}/changelog?limit=20`)

            if (!response.ok) {
                throw new Error('Failed to fetch changelog')
            }

            const data = await response.json()
            this.changelog = data.changelog || []
            this.renderChangelogList()
        } catch (error) {
            console.error('Error fetching changelog:', error)
            listEl.innerHTML = `
                <div class="error-message">
                    <p>Failed to load changelog. Please try again.</p>
                </div>
            `
        }
    }

    private renderChangelogList(): void {
        const listEl = document.getElementById('changelog-list')
        if (!listEl) return

        if (this.changelog.length === 0) {
            listEl.innerHTML = `
                <div class="no-servers">
                    <p>No changelog entries yet.</p>
                </div>
            `
            return
        }

        listEl.innerHTML = this.changelog
            .map((entry) => this.renderChangelogEntry(entry))
            .join('')
    }

    private renderChangelogEntry(entry: ChangelogEntry): string {
        return `
            <div class="changelog-entry">
                <div class="changelog-header">
                    <span class="changelog-version">${this.escapeHtml(entry.version)}</span>
                    <span class="changelog-date">${this.escapeHtml(entry.date)}</span>
                    <span class="changelog-tag ${entry.tag}">${entry.tag}</span>
                </div>
                <div class="changelog-content">
                    <ul>
                        ${entry.changes.map((change) => `<li>${this.escapeHtml(change)}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `
    }

    private quickPlay(): void {
        // Find the best available server (online with lowest player count relative to max)
        const availableServers = this.servers.filter((s) => s.isOnline)

        if (availableServers.length === 0) {
            alert('No servers available. Please try again later.')
            return
        }

        // Sort by available slots (descending) then by region preference
        availableServers.sort((a, b) => {
            const aSlots = a.maxPlayers - a.currentPlayers
            const bSlots = b.maxPlayers - b.currentPlayers
            return bSlots - aSlots
        })

        const server = availableServers[0]
        this.onServerSelect(this.normalizeHost(server.host), server.port)
    }

    async show(): Promise<void> {
        this.container.style.display = 'flex'

        // Check auth status and fetch servers in parallel
        await Promise.all([this.checkAuthStatus(), this.fetchServers()])

        // Auto-refresh every 10 seconds
        this.refreshInterval = window.setInterval(() => {
            this.fetchServers()
        }, 10000)
    }

    hide(): void {
        this.container.style.display = 'none'

        if (this.refreshInterval !== null) {
            clearInterval(this.refreshInterval)
            this.refreshInterval = null
        }
    }

    private async fetchServers(): Promise<void> {
        try {
            const response = await fetch(`${API_BASE}/servers`)

            if (!response.ok) {
                throw new Error(
                    `Failed to fetch servers: ${response.statusText}`
                )
            }

            const data = await response.json()
            // Handle both wrapped {servers: [...]} and direct [...] response
            this.servers = Array.isArray(data) ? data : data.servers || []
            this.renderServers(this.servers)
        } catch (error) {
            console.error('Error fetching servers:', error)
            this.showError('Failed to load server list. Please try again.')
        }
    }

    private renderServers(servers: GameServer[]): void {
        const serverList = document.getElementById('server-list')
        if (!serverList) return

        if (servers.length === 0) {
            serverList.innerHTML = `
                <div class="no-servers">
                    <p>No servers available at the moment.</p>
                    <p style="font-size: 0.875rem; margin-top: 8px;">Check back soon or start your own server!</p>
                </div>
            `
            return
        }

        serverList.innerHTML = servers
            .map((server) => this.createServerCard(server))
            .join('')

        // Attach click handlers
        servers.forEach((server) => {
            const card = document.getElementById(`server-${server.id}`)
            if (card && server.isOnline) {
                card.addEventListener('click', () => {
                    this.onServerSelect(
                        this.normalizeHost(server.host),
                        server.port
                    )
                })
            }
        })
    }

    private createServerCard(server: GameServer): string {
        const playerPercentage =
            (server.currentPlayers / server.maxPlayers) * 100
        const disabledClass = !server.isOnline ? 'disabled' : ''
        const statusClass = server.isOnline ? 'online' : 'offline'

        return `
            <div id="server-${server.id}" class="server-card ${disabledClass}">
                <div class="server-status-dot ${statusClass}"></div>
                <div class="server-info">
                    <span class="server-name">${this.escapeHtml(server.region)}</span>
                    <span class="server-host">${server.host}:${server.port}</span>
                </div>
                <div class="server-players">
                    <span>${server.currentPlayers}/${server.maxPlayers}</span>
                    <div class="player-bar">
                        <div class="player-bar-fill" style="width: ${playerPercentage}%"></div>
                    </div>
                </div>
                <span class="server-action">Join →</span>
            </div>
        `
    }

    private showError(message: string): void {
        const serverList = document.getElementById('server-list')
        if (serverList) {
            serverList.innerHTML = `
                <div class="error-message">
                    <p>⚠ ${this.escapeHtml(message)}</p>
                </div>
            `
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div')
        div.textContent = text
        return div.innerHTML
    }

    private normalizeHost(host: string): string {
        // Convert 0.0.0.0 to localhost for browser WebSocket connections
        // 0.0.0.0 is valid for server binding but not for client connections
        if (host === '0.0.0.0') {
            return 'localhost'
        }
        return host
    }

    // Public method to get the player name
    getPlayerName(): string {
        return this.playerName || 'Anonymous'
    }

    // Public method to get the current user (if logged in)
    getCurrentUser(): User | null {
        return this.currentUser
    }
}
