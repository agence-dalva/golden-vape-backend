import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { moneticoOptionsFromEnv } from './src/modules/monetico/lib/options'
import { sendcloudOptionsFromEnv } from './src/modules/sendcloud/lib/options'
import { resendOptionsFromEnv } from './src/modules/resend/lib/options'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    /*
      Compression des réponses HTTP, désactivée par défaut chez Medusa.

      Mesuré sur la recherche : 27 747 octets bruts contre 6 447 une fois gzippés, soit 4,3×.
      Le catalogue et la navigation sont du JSON tout aussi répétitif. Le gain porte sur
      l'égress de Railway autant que sur le temps de transfert.

      Seuil laissé à sa valeur par défaut, 1 024 octets : en deçà, l'en-tête gzip coûte plus
      que ce qu'il économise — la réponse d'une recherche sans résultat fait quarante octets.
    */
    http: {
      compression: {
        enabled: true,
      },
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  modules: [
    /*
      Le cache de Medusa sur Redis, plutôt que dans la mémoire du processus.

      Par défaut Medusa résout le module cache sur `cache-inmemory` : le cache n'est alors
      partagé ni entre deux répliques, ni entre deux redémarrages. Redis est pourtant déjà là
      — `redisUrl` plus haut lui confie les sessions — mais le framework ne bascule cache,
      bus d'événements et moteur de workflow dessus tout seul que sur son propre hébergement,
      quand `EXECUTION_CONTEXT` vaut `medusa-cloud`. Sur Railway, cette variable n'existe pas
      et la bascule ne se déclenche jamais. D'où cette déclaration explicite.

      Conditionnée à la présence de l'URL : en développement, sans Redis, Medusa retombe sur
      le cache mémoire et le code appelant ne voit pas la différence.
    */
    ...(process.env.REDIS_URL
      ? [
          {
            resolve: "@medusajs/medusa/cache-redis",
            options: { redisUrl: process.env.REDIS_URL },
          },
          /*
            Bus d'événements, moteur de workflows et verrous sur Redis eux aussi.

            Par défaut, les trois vivent dans la mémoire du processus. Un événement
            `order.placed` émis juste avant un redéploiement Railway disparaît alors avec le
            conteneur — et avec lui l'email de confirmation et la vente en caisse de cette
            commande ; un workflow interrompu ne reprend jamais. Sur Redis, les événements et
            les étapes en attente survivent au redémarrage et sont rejoués.

            C'est aussi ce qui permettra une seconde réplique : sans bus ni verrous partagés,
            chaque instance traiterait ses propres événements et lancerait ses propres tâches
            planifiées — la synchro Hiboutik tournerait deux fois.

            Le moteur de workflows repose sur BullMQ, qui exige un Redis en
            `maxmemory-policy noeviction` : une clé évincée est un workflow perdu.
          */
          {
            resolve: "@medusajs/medusa/event-bus-redis",
            options: { redisUrl: process.env.REDIS_URL },
          },
          {
            resolve: "@medusajs/medusa/workflow-engine-redis",
            // Seul module à lire son URL sous une clé `redis` — son chargeur n'a pas suivi
            // l'harmonisation des autres.
            options: { redis: { redisUrl: process.env.REDIS_URL } },
          },
          {
            resolve: "@medusajs/medusa/locking",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/locking-redis",
                  id: "locking-redis",
                  is_default: true,
                  options: { redisUrl: process.env.REDIS_URL },
                },
              ],
            },
          },
        ]
      : []),
    {
      resolve: "./src/modules/product-attribute",
    },
    {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "./src/modules/monetico",
            id: "monetico",
            options: moneticoOptionsFromEnv(),
          },
        ],
      },
    },
    /*
      Transporteurs.

      Medusa enregistre le module `fulfillment` implicitement, avec le seul provider
      `manual`. Le declarer ici pour y ajouter Sendcloud REMPLACE cette configuration
      implicite : omettre `manual` priverait de provider les options de livraison qui s'en
      servent deja, et casserait le panier. Les deux coexistent donc.

      Sendcloud sert d'agregateur — Colissimo, Chronopost et leurs points relais par une
      seule API — ce qui evite d'ecrire un provider par transporteur, dont un en SOAP.
    */
    {
      resolve: "@medusajs/fulfillment",
      options: {
        providers: [
          {
            resolve: "@medusajs/fulfillment-manual",
            id: "manual",
          },
          {
            resolve: "./src/modules/sendcloud",
            id: "sendcloud",
            options: sendcloudOptionsFromEnv(),
          },
        ],
      },
    },
    {
      resolve: "@medusajs/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/file-s3",
            id: "s3",
            options: {
              file_url: process.env.R2_PUBLIC_URL,
              access_key_id: process.env.R2_ACCESS_KEY_ID,
              secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
              region: "auto",
              bucket: process.env.R2_BUCKET,
              endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            },
          },
        ],
      },
    },
    /*
      Emails transactionnels — confirmation de commande, colis en route, mot de passe.

      Medusa n'envoie rien de lui-meme : il emet des evenements, nos subscribers
      rassemblent les donnees et demandent l'envoi, ce provider rend le template et le
      remet a Resend. Sans RESEND_API_KEY, les emails sont rendus dans `.medusa/emails/`
      au lieu de partir.
    */
    {
      resolve: "@medusajs/notification",
      options: {
        providers: [
          {
            resolve: "./src/modules/resend",
            id: "resend",
            options: {
              channels: ["email"],
              ...resendOptionsFromEnv(),
            },
          },
        ],
      },
    },
  ],
})
