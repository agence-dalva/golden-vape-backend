# Même version majeure que la base de production (Postgres 18 sur Railway) : un pg_dump plus
# ancien que le serveur refuse d'exporter.
FROM postgres:18-alpine

RUN apk add --no-cache aws-cli

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# L'image postgres lancerait un serveur : ici on exporte, on envoie, et on s'arrête.
ENTRYPOINT []
CMD ["/usr/local/bin/backup.sh"]
