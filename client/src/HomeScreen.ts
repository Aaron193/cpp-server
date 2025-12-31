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
}

export class HomeScreen {
    private container: HTMLElement
    private onServerSelect: (host: string, port: number) => void
    private refreshInterval: number | null = null
    private playerName: string = ''
    private servers: GameServer[] = []

    // Sample changelog data - replace with API call later
    private changelog: ChangelogEntry[] = [
        {
            version: 'v0.3.0',
            date: 'Dec 31, 2024',
            tag: 'new',
            changes: [
                'Added new home screen UI with server browser',
                'Implemented leaderboard system',
                'Added player name customization',
            ],
        },
        {
            version: 'v0.2.1',
            date: 'Dec 28, 2024',
            tag: 'fix',
            changes: [
                'Fixed server connection stability issues',
                'Resolved chat message display bugs',
                'Performance improvements for large lobbies',
            ],
        },
        {
            version: 'v0.2.0',
            date: 'Dec 20, 2024',
            tag: 'update',
            changes: [
                'New terrain rendering system',
                'Improved player interpolation',
                'Added chat bubbles above players',
            ],
        },
    ]

    // Sample leaderboard data - replace with API call later
    private leaderboard: LeaderboardEntry[] = [
        { rank: 1, name: 'xXSlayerXx', score: 15420, kills: 892, wins: 156 },
        { rank: 2, name: 'ProGamer99', score: 14200, kills: 756, wins: 142 },
        { rank: 3, name: 'NightHawk', score: 13890, kills: 701, wins: 138 },
        { rank: 4, name: 'ShadowBlade', score: 12450, kills: 623, wins: 121 },
        { rank: 5, name: 'ThunderStrike', score: 11200, kills: 589, wins: 108 },
        { rank: 6, name: 'IceQueen', score: 10800, kills: 534, wins: 99 },
        { rank: 7, name: 'FireDemon', score: 9950, kills: 498, wins: 91 },
        { rank: 8, name: 'StormChaser', score: 9200, kills: 456, wins: 84 },
        { rank: 9, name: 'DarkKnight', score: 8700, kills: 423, wins: 78 },
        { rank: 10, name: 'LightningBolt', score: 8100, kills: 398, wins: 72 },
    ]

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
                    <div class="auth-buttons">
                        <button id="login-btn" class="btn btn-secondary">
                            <span>🔐</span> Login
                        </button>
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
                        <!-- Server list populated dynamically -->
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
        const loginBtn = document.getElementById('login-btn')
        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.showLoginModal())
        }

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
                <form class="login-form" id="login-form">
                    <div class="form-group">
                        <label class="input-label" for="login-email">Email</label>
                        <input 
                            type="email" 
                            id="login-email" 
                            class="form-input" 
                            placeholder="Enter your email..."
                        />
                    </div>
                    <div class="form-group">
                        <label class="input-label" for="login-password">Password</label>
                        <input 
                            type="password" 
                            id="login-password" 
                            class="form-input" 
                            placeholder="Enter your password..."
                        />
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%;">
                        Login
                    </button>
                    <div class="form-divider">or</div>
                    <button type="button" class="btn btn-secondary" style="width: 100%;">
                        Continue as Guest
                    </button>
                </form>
                <div class="login-footer">
                    <p class="login-footer-text">
                        Don't have an account? <a href="#">Sign up</a>
                    </p>
                </div>
            </div>
        `)

        // Attach form handler
        const form = document.getElementById('login-form')
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault()
                // TODO: Implement login logic
                console.log('Login submitted')
                this.hideModal()
            })
        }
    }

    private showLeaderboardModal(): void {
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
                <div class="leaderboard-list">
                    ${this.leaderboard.map((entry) => this.renderLeaderboardEntry(entry)).join('')}
                </div>
            </div>
        `)

        // Tab switching
        const tabs = document.querySelectorAll('.leaderboard-tab')
        tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                tabs.forEach((t) => t.classList.remove('active'))
                tab.classList.add('active')
                // TODO: Fetch different leaderboard data based on period
            })
        })
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

    private showChangelogModal(): void {
        this.showModal(`
            <div class="modal-header">
                <h3 class="modal-title">Changelog</h3>
            </div>
            <div class="modal-body">
                <div class="changelog-list">
                    ${this.changelog.map((entry) => this.renderChangelogEntry(entry)).join('')}
                </div>
            </div>
        `)
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
        this.onServerSelect(server.host, server.port)
    }

    async show(): Promise<void> {
        this.container.style.display = 'flex'
        await this.fetchServers()

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
            const response = await fetch('/servers')

            if (!response.ok) {
                throw new Error(
                    `Failed to fetch servers: ${response.statusText}`
                )
            }

            this.servers = await response.json()
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
                    this.onServerSelect(server.host, server.port)
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

    // Public method to get the player name
    getPlayerName(): string {
        return this.playerName || 'Anonymous'
    }
}
