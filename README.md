# AlfyChat — Service Utilisateurs

Microservice d'authentification et de gestion des utilisateurs pour AlfyChat.

![Node.js](https://img.shields.io/badge/Bun-1.2-black?logo=bun)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-Source_Available-blue)

## Rôle

Ce service gère l'ensemble du cycle de vie des utilisateurs : inscription, connexion, vérification email, double authentification (2FA/TOTP), gestion des préférences, conformité RGPD, badges, statut personnalisé et clés de chiffrement E2EE.

## Stack technique

| Catégorie | Technologies |
|-----------|-------------|
| Runtime | Bun |
| Langage | TypeScript |
| API | Express |
| Auth | JWT (access + refresh), bcryptjs |
| 2FA | otplib (TOTP) |
| Email | Nodemailer |
| Cache | Redis |
| Base de données | MySQL 8 |

## Architecture globale

```
Frontend (:4000)  →  Gateway (:3000)  →  Microservices
                                          ├── users    (:3001)  ← ce service
                                          ├── messages  (:3002)
                                          ├── friends   (:3003)
                                          ├── calls     (:3004)
                                          ├── servers   (:3005)
                                          ├── bots      (:3006)
                                          └── media     (:3007)
```

## Démarrage

### Prérequis

- [Bun](https://bun.sh/) ≥ 1.2
- MySQL 8
- Redis 7

### Variables d'environnement

```env
PORT=3001
DB_HOST=localhost
DB_PORT=3306
DB_USER=alfychat
DB_PASSWORD=
DB_NAME=alfychat_users
REDIS_URL=redis://localhost:6379
JWT_SECRET=
JWT_REFRESH_SECRET=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SERVICE_REGISTRY_URL=http://gateway:3000
```

### Installation

```bash
bun install
```

### Développement

```bash
bun run dev
```

### Build production

```bash
bun run build
bun run start
```

### Docker

```bash
docker compose up users
```

## Structure du projet

```
src/
├── index.ts             # Point d'entrée
├── controllers/         # Auth, profil, 2FA, badges, préférences, changelog
├── routes/              # Définition des routes Express
├── services/            # AuthService, EmailService, TwoFactorService
├── middleware/          # Auth JWT, rate limiting
├── types/               # Types TypeScript
└── utils/               # Utilitaires (RGPD, clés E2EE)
```

## Contribution

Voir [CONTRIBUTING.md](./CONTRIBUTING.md).
