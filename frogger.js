// Frogger Game Logic

class FroggerGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.gameWidth = 400;
        this.gameHeight = 560;
        this.gridSize = 40;
        
        // Game state
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.isRunning = false;
        this.isPaused = false;
        this.gameOver = false;
        
        // Player
        this.player = {
            x: 180,
            y: 520,
            width: 30,
            height: 30,
            speed: 40
        };
        
        // Safe zones (goals)
        this.goals = [
            { x: 10, y: 10, reached: false },
            { x: 90, y: 10, reached: false },
            { x: 170, y: 10, reached: false },
            { x: 250, y: 10, reached: false },
            { x: 330, y: 10, reached: false }
        ];
        
        // Obstacles (cars)
        this.cars = [];
        this.initCars();
        
        // Water obstacles (logs and turtles)
        this.logs = [];
        this.initLogs();
        
        // Bind controls
        this.setupControls();
        
        // Animation frame
        this.lastTime = 0;
        this.animationId = null;
    }
    
    initCars() {
        // Row 1 - Fast cars moving right
        for (let i = 0; i < 3; i++) {
            this.cars.push({
                x: i * 150,
                y: 440,
                width: 60,
                height: 30,
                speed: 2 + this.level * 0.3,
                color: '#FF0000'
            });
        }
        
        // Row 2 - Medium cars moving left
        for (let i = 0; i < 2; i++) {
            this.cars.push({
                x: i * 200 + 100,
                y: 400,
                width: 50,
                height: 30,
                speed: -(1.5 + this.level * 0.3),
                color: '#0000FF'
            });
        }
        
        // Row 3 - Slow cars moving right
        for (let i = 0; i < 4; i++) {
            this.cars.push({
                x: i * 120,
                y: 360,
                width: 55,
                height: 30,
                speed: 1.2 + this.level * 0.2,
                color: '#FFD700'
            });
        }
        
        // Row 4 - Fast cars moving left
        for (let i = 0; i < 3; i++) {
            this.cars.push({
                x: i * 150 + 50,
                y: 320,
                width: 65,
                height: 30,
                speed: -(2.2 + this.level * 0.3),
                color: '#8B00FF'
            });
        }
        
        // Row 5 - Medium cars moving right
        for (let i = 0; i < 2; i++) {
            this.cars.push({
                x: i * 220,
                y: 280,
                width: 70,
                height: 30,
                speed: 1.8 + this.level * 0.25,
                color: '#FF69B4'
            });
        }
    }
    
    initLogs() {
        // Row 1 - Logs moving right
        for (let i = 0; i < 3; i++) {
            this.logs.push({
                x: i * 180,
                y: 200,
                width: 100,
                height: 30,
                speed: 1.5 + this.level * 0.2,
                type: 'log'
            });
        }
        
        // Row 2 - Logs moving left
        for (let i = 0; i < 2; i++) {
            this.logs.push({
                x: i * 250 + 75,
                y: 160,
                width: 120,
                height: 30,
                speed: -(1.2 + this.level * 0.2),
                type: 'log'
            });
        }
        
        // Row 3 - Turtles moving right
        for (let i = 0; i < 4; i++) {
            this.logs.push({
                x: i * 130,
                y: 120,
                width: 80,
                height: 30,
                speed: 1.8 + this.level * 0.25,
                type: 'turtle'
            });
        }
        
        // Row 4 - Logs moving left
        for (let i = 0; i < 3; i++) {
            this.logs.push({
                x: i * 160 + 40,
                y: 80,
                width: 110,
                height: 30,
                speed: -(1.4 + this.level * 0.2),
                type: 'log'
            });
        }
    }
    
    setupControls() {
        document.addEventListener('keydown', (e) => {
            if (!this.isRunning || this.isPaused || this.gameOver) return;
            
            const key = e.key.toLowerCase();
            
            // Arrow keys and WASD
            if (key === 'arrowup' || key === 'w') {
                e.preventDefault();
                this.movePlayer(0, -this.player.speed);
            } else if (key === 'arrowdown' || key === 's') {
                e.preventDefault();
                this.movePlayer(0, this.player.speed);
            } else if (key === 'arrowleft' || key === 'a') {
                e.preventDefault();
                this.movePlayer(-this.player.speed, 0);
            } else if (key === 'arrowright' || key === 'd') {
                e.preventDefault();
                this.movePlayer(this.player.speed, 0);
            }
        });
        
        // Button controls
        document.getElementById('startBtn').addEventListener('click', () => this.start());
        document.getElementById('pauseBtn').addEventListener('click', () => this.togglePause());
        document.getElementById('restartBtn').addEventListener('click', () => this.restart());
        document.getElementById('playAgainBtn').addEventListener('click', () => this.restart());
    }
    
    movePlayer(dx, dy) {
        const newX = this.player.x + dx;
        const newY = this.player.y + dy;
        
        // Boundary checking
        if (newX >= 0 && newX <= this.gameWidth - this.player.width) {
            this.player.x = newX;
        }
        
        if (newY >= 0 && newY <= this.gameHeight - this.player.height) {
            this.player.y = newY;
            
            // Score points for moving forward
            if (dy < 0 && this.player.y < 240) {
                this.score += 10;
                this.updateScore();
            }
        }
        
        this.checkGoalReached();
    }
    
    checkGoalReached() {
        // Check if player reached a goal
        if (this.player.y <= 40) {
            for (let goal of this.goals) {
                if (!goal.reached && 
                    this.player.x >= goal.x - 10 && 
                    this.player.x <= goal.x + 50) {
                    goal.reached = true;
                    this.score += 200;
                    this.updateScore();
                    this.resetPlayerPosition();
                    
                    // Check if all goals reached
                    if (this.goals.every(g => g.reached)) {
                        this.levelUp();
                    }
                    return;
                }
            }
            // Hit wrong spot at top
            this.loseLife();
        }
    }
    
    levelUp() {
        this.level++;
        this.score += 500;
        this.updateLevel();
        this.updateScore();
        
        // Reset goals
        this.goals.forEach(g => g.reached = false);
        
        // Reinitialize obstacles with increased difficulty
        this.cars = [];
        this.logs = [];
        this.initCars();
        this.initLogs();
        
        this.resetPlayerPosition();
    }
    
    resetPlayerPosition() {
        this.player.x = 180;
        this.player.y = 520;
    }
    
    loseLife() {
        this.lives--;
        this.updateLives();
        this.resetPlayerPosition();
        
        if (this.lives <= 0) {
            this.endGame();
        }
    }
    
    update() {
        if (!this.isRunning || this.isPaused) return;
        
        // Update cars
        for (let car of this.cars) {
            car.x += car.speed;
            
            // Wrap around screen
            if (car.speed > 0 && car.x > this.gameWidth) {
                car.x = -car.width;
            } else if (car.speed < 0 && car.x < -car.width) {
                car.x = this.gameWidth;
            }
        }
        
        // Update logs
        let playerOnLog = false;
        for (let log of this.logs) {
            log.x += log.speed;
            
            // Wrap around screen
            if (log.speed > 0 && log.x > this.gameWidth) {
                log.x = -log.width;
            } else if (log.speed < 0 && log.x < -log.width) {
                log.x = this.gameWidth;
            }
            
            // Check if player is on this log
            if (this.player.y >= log.y - 10 && 
                this.player.y <= log.y + 10 &&
                this.player.x + this.player.width > log.x &&
                this.player.x < log.x + log.width) {
                playerOnLog = true;
                this.player.x += log.speed; // Move with the log
                
                // Keep player on screen
                if (this.player.x < 0 || this.player.x > this.gameWidth - this.player.width) {
                    this.loseLife();
                }
            }
        }
        
        // Check if player is in water zone without being on a log
        if (this.player.y < 240 && this.player.y > 40 && !playerOnLog) {
            this.loseLife();
        }
        
        // Check car collisions
        this.checkCollisions();
    }
    
    checkCollisions() {
        // Check collision with cars (road area)
        if (this.player.y >= 280 && this.player.y <= 480) {
            for (let car of this.cars) {
                if (this.player.x + this.player.width > car.x &&
                    this.player.x < car.x + car.width &&
                    this.player.y + this.player.height > car.y &&
                    this.player.y < car.y + car.height) {
                    this.loseLife();
                    return;
                }
            }
        }
    }
    
    draw() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.gameWidth, this.gameHeight);
        
        // Draw background zones
        this.drawBackground();
        
        // Draw goals
        this.drawGoals();
        
        // Draw logs
        this.drawLogs();
        
        // Draw cars
        this.drawCars();
        
        // Draw player
        this.drawPlayer();
        
        // Draw pause overlay
        if (this.isPaused) {
            this.drawPauseOverlay();
        }
    }
    
    drawBackground() {
        // Goal zone (top)
        this.ctx.fillStyle = '#228B22';
        this.ctx.fillRect(0, 0, this.gameWidth, 50);
        
        // Water zone
        this.ctx.fillStyle = '#1E90FF';
        this.ctx.fillRect(0, 50, this.gameWidth, 190);
        
        // Safe zone (middle)
        this.ctx.fillStyle = '#90EE90';
        this.ctx.fillRect(0, 240, this.gameWidth, 40);
        
        // Road zone
        this.ctx.fillStyle = '#696969';
        this.ctx.fillRect(0, 280, this.gameWidth, 200);
        
        // Road lines
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([15, 10]);
        for (let i = 320; i < 480; i += 40) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, i);
            this.ctx.lineTo(this.gameWidth, i);
            this.ctx.stroke();
        }
        this.ctx.setLineDash([]);
        
        // Safe zone (bottom)
        this.ctx.fillStyle = '#90EE90';
        this.ctx.fillRect(0, 480, this.gameWidth, this.gameHeight - 480);
    }
    
    drawGoals() {
        for (let goal of this.goals) {
            if (goal.reached) {
                this.ctx.fillStyle = '#FFD700';
                this.ctx.font = 'bold 30px Arial';
                this.ctx.fillText('🐸', goal.x + 10, goal.y + 35);
            } else {
                this.ctx.fillStyle = '#006400';
                this.ctx.fillRect(goal.x, goal.y, 60, 30);
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.font = 'bold 20px Arial';
                this.ctx.fillText('🪷', goal.x + 15, goal.y + 25);
            }
        }
    }
    
    drawLogs() {
        for (let log of this.logs) {
            if (log.type === 'log') {
                // Draw log
                this.ctx.fillStyle = '#8B4513';
                this.ctx.fillRect(log.x, log.y, log.width, log.height);
                this.ctx.strokeStyle = '#654321';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(log.x, log.y, log.width, log.height);
                
                // Wood texture lines
                this.ctx.strokeStyle = '#A0522D';
                for (let i = 10; i < log.width; i += 20) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(log.x + i, log.y);
                    this.ctx.lineTo(log.x + i, log.y + log.height);
                    this.ctx.stroke();
                }
            } else {
                // Draw turtles
                this.ctx.fillStyle = '#2F4F2F';
                for (let i = 0; i < 3; i++) {
                    const turtleX = log.x + i * 25;
                    this.ctx.beginPath();
                    this.ctx.ellipse(turtleX + 12, log.y + 15, 12, 15, 0, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }
        }
    }
    
    drawCars() {
        for (let car of this.cars) {
            // Car body
            this.ctx.fillStyle = car.color;
            this.ctx.fillRect(car.x, car.y, car.width, car.height);
            
            // Car windows
            this.ctx.fillStyle = '#87CEEB';
            this.ctx.fillRect(car.x + 5, car.y + 5, car.width - 10, car.height - 10);
            
            // Car outline
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(car.x, car.y, car.width, car.height);
        }
    }
    
    drawPlayer() {
        // Draw frog emoji
        this.ctx.font = 'bold 30px Arial';
        this.ctx.fillText('🐸', this.player.x, this.player.y + 25);
    }
    
    drawPauseOverlay() {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.fillRect(0, 0, this.gameWidth, this.gameHeight);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = 'bold 40px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('PAUSED', this.gameWidth / 2, this.gameHeight / 2);
        this.ctx.textAlign = 'left';
    }
    
    gameLoop(timestamp) {
        if (!this.lastTime) this.lastTime = timestamp;
        const deltaTime = timestamp - this.lastTime;
        
        if (deltaTime >= 16.67) { // ~60 FPS
            this.update();
            this.draw();
            this.lastTime = timestamp;
        }
        
        if (this.isRunning) {
            this.animationId = requestAnimationFrame((t) => this.gameLoop(t));
        }
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.isPaused = false;
        document.getElementById('startBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = false;
        
        this.animationId = requestAnimationFrame((t) => this.gameLoop(t));
    }
    
    togglePause() {
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById('pauseBtn');
        pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
        
        if (!this.isPaused) {
            this.lastTime = 0;
            this.animationId = requestAnimationFrame((t) => this.gameLoop(t));
        }
    }
    
    restart() {
        // Reset game state
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.gameOver = false;
        this.isPaused = false;
        
        // Reset player
        this.resetPlayerPosition();
        
        // Reset goals
        this.goals.forEach(g => g.reached = false);
        
        // Reset obstacles
        this.cars = [];
        this.logs = [];
        this.initCars();
        this.initLogs();
        
        // Update UI
        this.updateScore();
        this.updateLives();
        this.updateLevel();
        
        // Hide game over modal
        document.getElementById('gameOverModal').classList.remove('show');
        
        // Reset buttons
        document.getElementById('startBtn').disabled = false;
        document.getElementById('pauseBtn').disabled = true;
        document.getElementById('pauseBtn').textContent = 'Pause';
        
        // Stop animation
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        this.isRunning = false;
        this.lastTime = 0;
        
        // Clear and redraw
        this.draw();
    }
    
    endGame() {
        this.gameOver = true;
        this.isRunning = false;
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Show game over modal
        document.getElementById('finalScore').textContent = this.score;
        document.getElementById('gameOverTitle').textContent = 'Game Over!';
        document.getElementById('gameOverMessage').innerHTML = `Final Score: <span id="finalScore">${this.score}</span><br>Level Reached: ${this.level}`;
        document.getElementById('gameOverModal').classList.add('show');
        
        // Reset buttons
        document.getElementById('startBtn').disabled = false;
        document.getElementById('pauseBtn').disabled = true;
    }
    
    updateScore() {
        document.getElementById('score').textContent = this.score;
    }
    
    updateLives() {
        document.getElementById('lives').textContent = this.lives;
    }
    
    updateLevel() {
        document.getElementById('level').textContent = this.level;
    }
}

// Initialize game when page loads
let game;
window.addEventListener('DOMContentLoaded', () => {
    game = new FroggerGame();
    game.draw(); // Draw initial state
});
