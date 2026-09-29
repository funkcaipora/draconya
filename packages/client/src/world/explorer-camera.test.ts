import { describe, expect, it } from 'vitest';
import { changeFloor, DEFAULT_CAMERA, dragBy, formatCamera, pan, parseCamera } from './explorer-camera.js';

describe('câmera do explorador', () => {
  it('anda por tiles e não passa de zero', () => {
    expect(pan({ x: 10, y: 10, z: 7 }, 3, -2)).toEqual({ x: 13, y: 8, z: 7 });
    expect(pan({ x: 1, y: 1, z: 7 }, -5, -5)).toEqual({ x: 0, y: 0, z: 7 });
  });

  it('troca de andar presa a 0–15', () => {
    expect(changeFloor({ x: 0, y: 0, z: 7 }, 1).z).toBe(8);
    expect(changeFloor({ x: 0, y: 0, z: 15 }, 1).z).toBe(15);
    expect(changeFloor({ x: 0, y: 0, z: 0 }, -1).z).toBe(0);
  });

  it('arrastar move no sentido contrário, em tiles de tela', () => {
    expect(dragBy({ x: 100, y: 100, z: 7 }, 64, -32, 32)).toEqual({ x: 98, y: 101, z: 7 });
  });

  it('lê e escreve x,y,z', () => {
    expect(parseCamera('#32369, 32241, 7')).toEqual({ x: 32369, y: 32241, z: 7 });
    expect(parseCamera('1,2')).toBeNull();
    expect(parseCamera('1,2,16')).toBeNull();
    expect(parseCamera('a,b,c')).toBeNull();
    expect(formatCamera({ x: 10.6, y: 3.2, z: 8 })).toBe('11,3,8');
    expect(parseCamera(formatCamera(DEFAULT_CAMERA))).toEqual(DEFAULT_CAMERA);
  });
});
