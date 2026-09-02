import {
  buildSealString,
  computeSeal,
  toOperationalKey,
  verifySeal,
} from "../lib/seal"
import {
  buildPaymentRequest,
  encodeOrderContext,
  formatAmount,
  formatDate,
} from "../lib/payment-request"
import type { MoneticoOptions } from "../types"

// Clé d'exemple de la documentation technique v2.0, §1.3.
const KEY = "0123456789ABCDEF0123456789ABCDEF01234567"

/**
 * Liste de champs de l'exemple §9.3.1.1 de la documentation. Elle ne sert qu'à reproduire
 * cet exemple : le serveur de Monetico, lui, scelle les champs réellement postés — voir le
 * commentaire en tête de `payment-request.ts`.
 */
const DOC_EXAMPLE_FIELDS = [
  "TPE", "contexte_commande", "date",
  "dateech1", "dateech2", "dateech3", "dateech4",
  "lgue", "mail", "montant",
  "montantech1", "montantech2", "montantech3", "montantech4",
  "nbrech", "options", "reference", "societe", "texte-libre", "version",
] as const

const OPTIONS: MoneticoOptions = {
  tpe: "1234567",
  societe: "monSite1",
  key: KEY,
  sandbox: true,
  urlRetourOk: "https://boutique.test/ok",
  urlRetourErr: "https://boutique.test/ko",
  lgue: "FR",
  timezone: "Europe/Paris",
}

describe("toOperationalKey", () => {
  it("convertit les 40 caractères hexadécimaux en 20 octets", () => {
    expect(toOperationalKey(KEY)).toHaveLength(20)
  })

  it("refuse une clé qui n'est pas hexadécimale sur 40 caractères", () => {
    expect(() => toOperationalKey("trop-court")).toThrow(/40 caractères hexadécimaux/)
  })
})

describe("buildSealString", () => {
  // Chaîne « paiement comptant » reproduite de la documentation technique v2.0, §9.3.1.1.
  it("reproduit la chaîne à certifier de la documentation", () => {
    const fields: Record<string, string> = Object.fromEntries(
      DOC_EXAMPLE_FIELDS.map((field) => [field, ""])
    )

    Object.assign(fields, {
      TPE: "1234567",
      contexte_commande: "ewoJIkJJTExJTkciOnt9Cn0=",
      date: "05/12/2006:11:55:23",
      lgue: "FR",
      mail: "internaute@sonemail.fr",
      montant: "62.73EUR",
      reference: "ABERTYP00145",
      societe: "monSite1",
      "texte-libre": "ExempleTexteLibre",
      version: "3.0",
    })

    expect(buildSealString(fields)).toBe(
      "TPE=1234567" +
        "*contexte_commande=ewoJIkJJTExJTkciOnt9Cn0=" +
        "*date=05/12/2006:11:55:23" +
        "*dateech1=*dateech2=*dateech3=*dateech4=" +
        "*lgue=FR" +
        "*mail=internaute@sonemail.fr" +
        "*montant=62.73EUR" +
        "*montantech1=*montantech2=*montantech3=*montantech4=" +
        "*nbrech=" +
        "*options=" +
        "*reference=ABERTYP00145" +
        "*societe=monSite1" +
        "*texte-libre=ExempleTexteLibre" +
        "*version=3.0"
    )
  })

  it("trie les champs selon l'ordre ASCII, majuscules avant minuscules", () => {
    expect(buildSealString({ b: "2", TPE: "1", a: "3" })).toBe("TPE=1*a=3*b=2")
  })
})

describe("computeSeal", () => {
  it("produit le HMAC-SHA1 de la chaîne à certifier", () => {
    const fields: Record<string, string> = Object.fromEntries(
      DOC_EXAMPLE_FIELDS.map((field) => [field, ""])
    )

    Object.assign(fields, {
      TPE: "1234567",
      contexte_commande: "ewoJIkJJTExJTkciOnt9Cn0=",
      date: "05/12/2006:11:55:23",
      lgue: "FR",
      mail: "internaute@sonemail.fr",
      montant: "62.73EUR",
      reference: "ABERTYP00145",
      societe: "monSite1",
      "texte-libre": "ExempleTexteLibre",
      version: "3.0",
    })

    // Valeur calculée indépendamment : openssl dgst -sha1 -mac HMAC -macopt hexkey:<clé>
    expect(computeSeal(fields, KEY)).toBe("a31509adce002211efc8aa8889f1efa14d4c0e61")
  })
})

describe("verifySeal", () => {
  const fields = { TPE: "1234567", version: "3.0" }

  it("accepte le sceau renvoyé en majuscules par l'interface « Retour »", () => {
    expect(verifySeal(fields, KEY, computeSeal(fields, KEY).toUpperCase())).toBe(true)
  })

  it("rejette un sceau falsifié", () => {
    expect(verifySeal(fields, KEY, "0".repeat(40))).toBe(false)
  })

  it("rejette un sceau de longueur inattendue", () => {
    expect(verifySeal(fields, KEY, "abc")).toBe(false)
  })
})

describe("formatAmount", () => {
  it("colle le code devise en majuscules au montant à deux décimales", () => {
    expect(formatAmount(62.7, "eur")).toBe("62.70EUR")
    expect(formatAmount(100, "EUR")).toBe("100.00EUR")
  })
})

describe("formatDate", () => {
  it("rend la date au format JJ/MM/AAAA:HH:MM:SS dans le fuseau du commerçant", () => {
    // 2024-05-24T08:00:25Z vaut 10:00:25 à Paris (heure d'été).
    expect(formatDate(new Date("2024-05-24T08:00:25Z"), "Europe/Paris")).toBe(
      "24/05/2024:10:00:25"
    )
  })

  it("rend minuit « 00 » et non « 24 »", () => {
    expect(formatDate(new Date("2024-01-14T23:00:00Z"), "Europe/Paris")).toBe(
      "15/01/2024:00:00:00"
    )
  })
})

describe("encodeOrderContext", () => {
  it("retire les valeurs absentes plutôt que d'envoyer des chaînes vides", () => {
    const encoded = encodeOrderContext({
      billing: {
        firstName: "Jérémy",
        lastName: "",
        addressLine1: "3 rue de l'église",
        city: "Ostheim",
        postalCode: "68150",
        country: "FR",
      },
      shoppingCart: { shoppingCartItems: [] },
    })

    expect(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))).toEqual({
      billing: {
        firstName: "Jérémy",
        addressLine1: "3 rue de l'église",
        city: "Ostheim",
        postalCode: "68150",
        country: "FR",
      },
    })
  })
})

describe("buildPaymentRequest", () => {
  const form = buildPaymentRequest({
    options: OPTIONS,
    reference: "ABERTYP00145",
    amount: 62.73,
    currencyCode: "eur",
    texteLibre: "payses_01ABC",
    orderContext: {
      billing: {
        addressLine1: "3 rue de l'église",
        city: "Ostheim",
        postalCode: "68150",
        country: "FR",
      },
    },
    email: "internaute@sonemail.fr",
    date: new Date("2006-12-05T10:55:23Z"),
  })

  it("vise le serveur de validation quand le mode bac à sable est actif", () => {
    expect(form.actionUrl).toBe("https://p.monetico-services.com/test/paiement.cgi")
  })

  it("ne poste ni les échéances vides ni le champ « options »", () => {
    expect(form.fields).not.toHaveProperty("dateech1")
    expect(form.fields).not.toHaveProperty("nbrech")
    expect(form.fields).not.toHaveProperty("options")
  })

  it("poste les champs obligatoires et les URLs de retour", () => {
    expect(form.fields).toMatchObject({
      TPE: "1234567",
      version: "3.0",
      societe: "monSite1",
      lgue: "FR",
      montant: "62.73EUR",
      reference: "ABERTYP00145",
      "texte-libre": "payses_01ABC",
      mail: "internaute@sonemail.fr",
      date: "05/12/2006:11:55:23",
      url_retour_ok: "https://boutique.test/ok",
      url_retour_err: "https://boutique.test/ko",
    })
    expect(form.fields.MAC).toMatch(/^[0-9a-f]{40}$/)
  })

  it("scelle exactement les champs postés, URLs de retour comprises", () => {
    // La règle vient du serveur de Monetico, qui affiche la chaîne qu'il reconstitue
    // quand le sceau ne correspond pas : tout ce qui est posté sauf le MAC lui-même.
    const { MAC, ...posted } = form.fields

    expect(computeSeal(posted, KEY)).toBe(MAC)
    expect(buildSealString(posted)).toContain("url_retour_ok=https://boutique.test/ok")
    expect(buildSealString(posted)).toContain("url_retour_err=https://boutique.test/ko")
  })

  it("laisse hors du sceau les champs vides d'un paiement comptant", () => {
    const { MAC, ...posted } = form.fields
    const sealed = buildSealString(posted)

    for (const absent of ["dateech1", "montantech1", "nbrech", "options"]) {
      expect(sealed).not.toContain(`${absent}=`)
    }
  })
})
