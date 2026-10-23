import { describe, expect, it } from "vitest";
import {
  CAMPANAS,
  campanaDeEtapa,
  motivoParaNoEnviar,
  renderizarCampana,
} from "./campanas-email";
import { ETAPAS } from "./embudo-alta";

const RENDER = {
  urlBase: "https://app.comerz.app",
  envioId: "11111111-2222-3333-4444-555555555555",
};

describe("los dos casos que motivaron esto", () => {
  it("al que nunca confirmó el mail NO se le habla de configurar el negocio", () => {
    // maxi_l93@hotmail.com, alta 29/8/2026: sin confirmar y sin entrar nunca.
    // El paso que le falta es entrar, no crear el negocio.
    const campana = campanaDeEtapa("REGISTRADO")!;

    expect(campana.cta.ruta).toBe("/ingresar");
    expect(campana.asunto).not.toMatch(/configur/i);
  });

  it("al que abrió el link y no volvió se le pide crear el negocio", () => {
    // daitri94gallardo@gmail.com: confirmó a los 30 s, sesión 2 s después.
    const campana = campanaDeEtapa("SESION")!;

    expect(campana.asunto).toBe(
      "Te falta un paso para empezar a usar Comerz",
    );
    expect(campana.cta.ruta).toBe("/empezar");
  });

  it("las dos campañas son distintas", () => {
    expect(campanaDeEtapa("REGISTRADO")!.clave).not.toBe(
      campanaDeEtapa("SESION")!.clave,
    );
  });
});

describe("a quién no se le escribe", () => {
  it("al que ya creó su negocio no le corresponde ninguna campaña", () => {
    // Escribirle "te falta un paso" a alguien que ya está adentro es la forma
    // más rápida de que marque el mail como spam.
    expect(campanaDeEtapa("CREO_NEGOCIO")).toBeNull();
    expect(
      motivoParaNoEnviar({
        etapa: "CREO_NEGOCIO",
        esPrueba: false,
        dadoDeBaja: false,
        campanasYaEnviadas: new Set(),
      }),
    ).toBe("SIN_CAMPANA");
  });

  it("la baja gana sobre todo lo demás", () => {
    expect(
      motivoParaNoEnviar({
        etapa: "SESION",
        esPrueba: true,
        dadoDeBaja: true,
        campanasYaEnviadas: new Set(["sin_negocio_creado"]),
      }),
    ).toBe("DADO_DE_BAJA");
  });

  it("no se le escribe dos veces la misma campaña", () => {
    expect(
      motivoParaNoEnviar({
        etapa: "SESION",
        esPrueba: false,
        dadoDeBaja: false,
        campanasYaEnviadas: new Set(["sin_negocio_creado"]),
      }),
    ).toBe("YA_ENVIADO");
  });

  it("haberle mandado OTRA campaña no bloquea la de su etapa actual", () => {
    // Alguien que recibió el de "no confirmaste", confirmó, y ahora está
    // parado sin crear el negocio: le toca el segundo mail.
    expect(
      motivoParaNoEnviar({
        etapa: "SESION",
        esPrueba: false,
        dadoDeBaja: false,
        campanasYaEnviadas: new Set(["alta_sin_confirmar"]),
      }),
    ).toBeNull();
  });

  it("no se le escribe a una cuenta de prueba propia", () => {
    expect(
      motivoParaNoEnviar({
        etapa: "SESION",
        esPrueba: true,
        dadoDeBaja: false,
        campanasYaEnviadas: new Set(),
      }),
    ).toBe("ES_PRUEBA");
  });
});

describe("el render", () => {
  const { asunto, texto, html } = renderizarCampana(
    campanaDeEtapa("SESION")!,
    RENDER,
  );

  it("el CTA cuelga de la URL base que se le pasa", () => {
    // Absoluto en el archivo mandaría a producción probando en local.
    expect(texto).toContain("https://app.comerz.app/empezar");
    expect(html).toContain('href="https://app.comerz.app/empezar"');
  });

  it("el link de baja lleva el id del envío", () => {
    const url = `https://app.comerz.app/baja-mails/${RENDER.envioId}`;
    expect(texto).toContain(url);
    expect(html).toContain(url);
  });

  it("manda las dos versiones, no solo HTML", () => {
    // Un mail sin texto plano puntúa peor en los filtros de spam.
    expect(texto.length).toBeGreaterThan(200);
    expect(asunto).not.toBe("");
  });

  it("el texto plano incluye los bullets", () => {
    expect(texto).toContain("• Controlar el stock sin planillas");
  });

  it("no deja una barra doble si la URL base viene con barra final", () => {
    const { texto: t } = renderizarCampana(campanaDeEtapa("SESION")!, {
      ...RENDER,
      urlBase: "https://app.comerz.app/",
    });
    expect(t).not.toContain("comerz.app//empezar");
    expect(t).toContain("https://app.comerz.app/empezar");
  });
});

describe("invariantes de todas las campañas", () => {
  const campanas = ETAPAS.map(campanaDeEtapa).filter((c) => c !== null);

  it("las claves son únicas: son la unidad de idempotencia", () => {
    // Dos etapas con la misma clave harían que mandar una bloquee la otra.
    const claves = campanas.map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("todas ofrecen una salida humana", () => {
    for (const c of campanas) {
      expect(c.cierre.join(" ")).toContain("+54 1154702118");
    }
  });

  it("todas se pueden dar de baja", () => {
    for (const c of campanas) {
      const { html, texto } = renderizarCampana(c, RENDER);
      expect(html).toContain("/baja-mails/");
      expect(texto).toContain("/baja-mails/");
    }
  });

  it("hay campaña para toda etapa que no sea el final del embudo", () => {
    for (const etapa of ETAPAS) {
      if (etapa === "CREO_NEGOCIO") continue;
      expect(CAMPANAS[etapa], `falta la campaña de ${etapa}`).not.toBeNull();
    }
  });
});
