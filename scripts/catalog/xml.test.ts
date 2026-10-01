import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attr, attrNumber, attrNumberOptional, attrOptional, childrenOf, parseXml, readXmlFile } from './xml.js';

// Uma fixture PEQUENA, escrita por nós no formato do items.xml (elemento com atributos e
// filhos <attribute> aninhados) — nunca um trecho copiado do Canary. É estrutura de XML, não
// número de jogo: o valor do domínio entra por teste próprio quando o importador de verdade
// existir (#573).
const FIXTURE = `<?xml version="1.0" encoding="ISO-8859-1"?>
<items>
	<!-- comentário de topo, deve sumir -->
	<item id="1" name="sample one"/>
	<item id="2" article="a" name="sample two">
		<attribute key="weight" value="10"/>
		<attribute key="field" value="poison">
			<attribute key="ticks" value="5000"/>
		</attribute>
	</item>
</items>
`;

describe('parseXml', () => {
  it('lê a raiz, ignora o prólogo e o comentário de topo', () => {
    const root = parseXml(FIXTURE);
    expect(root.tag).toBe('items');
    expect(childrenOf(root, 'item')).toHaveLength(2);
  });

  it('um elemento com UM filho vira array de UM, igual a dois filhos — sem colapso', () => {
    // O motivo de existir este módulo em vez de usar o fast-xml-parser cru: no modo padrão
    // da biblioteca um único filho repetido vira objeto solto, não array — e o item #1 (sem
    // <attribute>) e o #2 (com dois) precisam ser tratados pela MESMA forma.
    const root = parseXml(FIXTURE);
    const [first, second] = childrenOf(root, 'item');
    expect(first?.children).toEqual([]);
    expect(second?.children).toHaveLength(2);
  });

  it('atributos ficam disponíveis por nome, e <attribute> aninhado também', () => {
    const root = parseXml(FIXTURE);
    const second = childrenOf(root, 'item')[1];
    expect(second).toBeDefined();
    expect(attr(second as never, 'name')).toBe('sample two');
    expect(attrOptional(second as never, 'article')).toBe('a');
    expect(attrOptional(second as never, 'nao-existe')).toBeUndefined();
    const attributes = childrenOf(second as never, 'attribute');
    expect(attributes.map((a) => attr(a, 'key'))).toEqual(['weight', 'field']);
    const field = attributes[1];
    expect(field).toBeDefined();
    const nested = childrenOf(field as never, 'attribute');
    expect(nested).toHaveLength(1);
    expect(attr(nested[0] as never, 'key')).toBe('ticks');
    expect(attrNumber(nested[0] as never, 'value')).toBe(5000);
  });

  it('attr lança quando o atributo obrigatório está ausente', () => {
    const root = parseXml(FIXTURE);
    const first = childrenOf(root, 'item')[0];
    expect(() => attr(first as never, 'article')).toThrow(/sem atributo "article"/);
  });

  it('attrNumber lança quando o valor não é numérico', () => {
    const root = parseXml('<x a="não-é-número"/>');
    expect(() => attrNumber(root, 'a')).toThrow(/não é numérico/);
  });

  it('attrNumberOptional devolve undefined quando ausente, e o número quando presente', () => {
    const root = parseXml('<x a="7"/>');
    expect(attrNumberOptional(root, 'a')).toBe(7);
    expect(attrNumberOptional(root, 'b')).toBeUndefined();
  });
});

describe('readXmlFile', () => {
  it('lê do disco e devolve a mesma árvore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-xml-'));
    try {
      const path = join(dir, 'items.xml');
      writeFileSync(path, FIXTURE);
      const root = readXmlFile(path);
      expect(root.tag).toBe('items');
      expect(childrenOf(root, 'item')).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('erro de arquivo ausente cita o caminho', () => {
    expect(() => readXmlFile('/nao/existe.xml')).toThrow('/nao/existe.xml');
  });
});
