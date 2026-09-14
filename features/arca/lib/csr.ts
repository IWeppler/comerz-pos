import forge from "node-forge";

/**
 * Par de claves + CSR para pedir el certificado en ARCA.
 *
 * Todo pasa en el server: la clave privada se genera acá, se cifra y se
 * guarda; lo único que ve la persona es el CSR, que es público por
 * definición (es lo que se pega en "Administrador de Certificados
 * Digitales" de ARCA). El certificado que ARCA devuelve se sube después y se
 * verifica contra la clave que lo originó.
 *
 * El subject sigue lo que pide ARCA: CN es un alias cualquiera, O es el
 * nombre del comercio, C = AR y `serialNumber = CUIT <cuit>`. Ese último
 * es el que ARCA valida contra el CUIT que pide el certificado.
 *
 * RSA 2048: es lo que ARCA acepta y lo que node-forge genera en un tiempo
 * razonable (~1 s en el server). 4096 tarda diez veces más y no cambia nada
 * para este uso.
 */

export interface ParClaves {
  clavePrivadaPem: string;
  csrPem: string;
}

export function generarClaveYCsr(datos: {
  cuit: string;
  razonSocial: string;
  alias: string;
}): ParClaves {
  const cuit = datos.cuit.replaceAll(/\D/g, "");
  if (cuit.length !== 11) {
    throw new Error("El CUIT del comercio tiene que tener 11 dígitos.");
  }

  const claves = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });

  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = claves.publicKey;
  csr.setSubject([
    { name: "countryName", value: "AR" },
    { name: "organizationName", value: datos.razonSocial.trim() || "Comercio" },
    { name: "commonName", value: datos.alias.trim() || "comerz" },
    { name: "serialNumber", value: `CUIT ${cuit}` },
  ]);
  csr.sign(claves.privateKey, forge.md.sha256.create());

  return {
    clavePrivadaPem: forge.pki.privateKeyToPem(claves.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr),
  };
}

export interface DatosCertificado {
  /** ISO. */
  vencimiento: string;
  /** ISO. */
  emision: string;
  subject: string;
}

/**
 * Valida que el certificado sea PEM, que corresponda a la clave privada que
 * generó el CSR, y devuelve sus fechas. El certificado equivocado —de otro
 * CUIT, de otro par de claves— firmaría TRAs que ARCA rechaza con un mensaje
 * inútil; acá se frena con uno claro.
 */
export function inspeccionarCertificado(
  certificadoPem: string,
  clavePrivadaPem: string,
): DatosCertificado {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certificadoPem.trim());
  } catch {
    throw new Error(
      "El certificado no es un .crt/.pem válido. Tiene que empezar con -----BEGIN CERTIFICATE-----.",
    );
  }

  const clave = forge.pki.privateKeyFromPem(clavePrivadaPem);
  const publicaDeClave = forge.pki.setRsaPublicKey(clave.n, clave.e);
  const coincide =
    forge.pki.publicKeyToPem(publicaDeClave) ===
    forge.pki.publicKeyToPem(cert.publicKey as forge.pki.rsa.PublicKey);
  if (!coincide) {
    throw new Error(
      "Este certificado no corresponde al CSR generado acá: fue emitido para otra clave. Generá el CSR de nuevo o subí el certificado correcto.",
    );
  }

  return {
    vencimiento: cert.validity.notAfter.toISOString(),
    emision: cert.validity.notBefore.toISOString(),
    subject: cert.subject.attributes
      .map((a) => `${a.shortName ?? a.name}=${a.value}`)
      .join(", "),
  };
}
