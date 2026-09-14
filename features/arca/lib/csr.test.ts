import { describe, expect, it } from "vitest";
import forge from "node-forge";
import { generarClaveYCsr, inspeccionarCertificado } from "./csr";
import { firmarTra } from "./wsaa";

function autofirmar(clavePrivadaPem: string, csrPem: string): string {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  const clave = forge.pki.privateKeyFromPem(clavePrivadaPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey!;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01");
  cert.validity.notAfter = new Date("2028-01-01");
  cert.setSubject(csr.subject.attributes);
  cert.setIssuer(csr.subject.attributes);
  cert.sign(clave, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe("clave + CSR para ARCA", () => {
  // Generar RSA 2048 tarda ~1 s: se hace UNA vez para todos los casos.
  const par = generarClaveYCsr({
    cuit: "30-71234567-8",
    razonSocial: "Evens Indumentaria",
    alias: "comerz",
  });

  it("el CSR lleva el CUIT en serialNumber, que es lo que ARCA valida", () => {
    const csr = forge.pki.certificationRequestFromPem(par.csrPem);
    const serial = csr.subject.getField({ name: "serialNumber" });
    expect(serial?.value).toBe("CUIT 30712345678");
    expect(csr.subject.getField("CN")?.value).toBe("comerz");
    expect(csr.verify()).toBe(true);
  });

  it("rechaza un CUIT que no tiene 11 dígitos", () => {
    expect(() =>
      generarClaveYCsr({ cuit: "123", razonSocial: "x", alias: "y" }),
    ).toThrow(/11 dígitos/);
  });

  it("acepta el certificado que sale de ese CSR y devuelve sus fechas", () => {
    const certPem = autofirmar(par.clavePrivadaPem, par.csrPem);
    const datos = inspeccionarCertificado(certPem, par.clavePrivadaPem);
    expect(datos.vencimiento).toBe("2028-01-01T00:00:00.000Z");
    expect(datos.subject).toContain("CUIT 30712345678");
  });

  it("rechaza un certificado de OTRA clave con un mensaje que lo dice", () => {
    const otro = generarClaveYCsr({
      cuit: "20111111112",
      razonSocial: "Otro",
      alias: "otro",
    });
    const certAjeno = autofirmar(otro.clavePrivadaPem, otro.csrPem);
    expect(() =>
      inspeccionarCertificado(certAjeno, par.clavePrivadaPem),
    ).toThrow(/otra clave/);
  });

  it("rechaza texto que no es un certificado", () => {
    expect(() => inspeccionarCertificado("hola", par.clavePrivadaPem)).toThrow(
      /BEGIN CERTIFICATE/,
    );
  });

  it("firma un TRA como CMS que se puede volver a leer y verificar", () => {
    const certPem = autofirmar(par.clavePrivadaPem, par.csrPem);
    const tra = `<loginTicketRequest><service>wsfe</service></loginTicketRequest>`;
    const cms = firmarTra(tra, par.clavePrivadaPem, certPem);

    const der = forge.util.decode64(cms);
    const p7 = forge.pkcs7.messageFromAsn1(
      forge.asn1.fromDer(der),
    ) as forge.pkcs7.PkcsSignedData & {
      rawCapture: { content: { value: Array<{ value: string }> } };
    };
    // forge no rellena `content` al parsear: el TRA queda en rawCapture.
    expect(p7.rawCapture.content.value[0].value).toBe(tra);
    expect(p7.certificates).toHaveLength(1);
  });
});
