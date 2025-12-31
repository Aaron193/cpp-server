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

export class HomeScreen {
    private container: HTMLElement
    private serverListElement: HTMLElement
    private onServerSelect: (host: string, port: number) => void
    private refreshInterval: number | null = null

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

        // Create server list element
        this.serverListElement = document.createElement('div')
        this.serverListElement.id = 'server-list'

        this.setupUI()
    }

    private setupUI(): void {
        this.container.innerHTML = `
            <div class="home-screen-content">
                <h1 class="game-title">Game Lobby</h1>
                <div class="server-list-header">
                    <h2>Available Servers</h2>
                    <button id="refresh-button" class="refresh-btn">Refresh</button>
                </div>
                <div id="server-list"></div>
            </div>
        `

        this.serverListElement = document.getElementById('server-list')!

        const refreshBtn = document.getElementById('refresh-button')
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.fetchServers())
        }
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

            const servers: GameServer[] = await response.json()
            this.renderServers(servers)
        } catch (error) {
            console.error('Error fetching servers:', error)
            this.showError('Failed to load server list. Please try again.')
        }
    }

    private renderServers(servers: GameServer[]): void {
        if (servers.length === 0) {
            this.serverListElement.innerHTML = `
                <div class="no-servers">
                    <p>No servers available at the moment.</p>
                    <p class="hint">Check back soon or start your own server!</p>
                </div>
            `
            return
        }

        this.serverListElement.innerHTML = servers
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
        const statusClass = server.isOnline ? 'online' : 'offline'
        const disabledClass = !server.isOnline ? 'disabled' : ''

        return `
            <div id="server-${server.id}" class="server-card ${statusClass} ${disabledClass}">
                <div class="server-header">
                    <h3 class="server-name">${server.region.toUpperCase()}</h3>
                    <span class="server-status ${statusClass}">${server.isOnline ? '● ONLINE' : '● OFFLINE'}</span>
                </div>
                <div class="server-info">
                    <div class="server-detail">
                        <span class="label">Host:</span>
                        <span class="value">${server.host}:${server.port}</span>
                    </div>
                    <div class="server-detail">
                        <span class="label">Players:</span>
                        <span class="value">${server.currentPlayers} / ${server.maxPlayers}</span>
                    </div>
                </div>
                <div class="player-bar">
                    <div class="player-bar-fill" style="width: ${playerPercentage}%"></div>
                </div>
                ${server.isOnline ? '<div class="play-hint">Click to join →</div>' : ''}
            </div>
        `
    }

    private showError(message: string): void {
        this.serverListElement.innerHTML = `
            <div class="error-message">
                <p>⚠ ${message}</p>
            </div>
        `
    }
}
