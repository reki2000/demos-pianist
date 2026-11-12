'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
function inspect(source) {
  let bound, matrix, normal, color;
  const draws = [], gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, useProgram() {},
    getAttribLocation: (_, n) => n === 'aP' ? 0 : 1, getUniformLocation: (_, n) => n,
    createBuffer: () => ({}), bindBuffer: (_, b) => { bound = b; }, bufferData: (_, data) => { bound.data = Array.from(data); },
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    uniformMatrix4fv: (n, _, m) => { if (n === 'uM') matrix = Array.from(m); },
    uniformMatrix3fv: (_, __, m) => { normal = Array.from(m); },
    uniform3fv: (n, v) => { if (n === 'uC') color = Array.from(v); }, uniform1f() {},
    drawArrays: (_, __, count) => draws.push({ vertices: bound.data, matrix, normal, color, triangles: count / 3 }),
  };
  const c = { window: {} }; vm.createContext(c); vm.runInContext(source, c);
  const R = c.window.RecitalGL.create({ getContext: () => gl });
  R.setFaceDetail?.(true);
  for (const name of ['head', 'hair', 'nose', 'joint']) R.piece(name, [.1, 1.7, .2], [.012, .03, .022], [.74, .55, .43], .2, .4, .1);
  for (const radius of [.0016, .002, .0028, .0032, .0037, .0042]) R.segment([0, 1.8, .1], [.02, 1.8, .12], radius, [.2, .12, .1]);
  R.ball([0, 1.7, 0], [.01, .01, .01], [.7, .5, .3]);
  const faceHash = crypto.createHash('sha256').update(JSON.stringify(draws)).digest('hex');
  draws.length = 0; R.setFaceDetail?.(false);
  for (const name of ['torso', 'jacket', 'palm', 'shoe', 'cushion']) R.piece(name, [0, 1, 0], [.1, .2, .1], [.1, .1, .1]);
  for (let i = 0; i < 100; i++) {
    R.segment([0, 0, 0], [0, .1, 0], .01, [.7, .5, .3]);
    R.bone([0, 0, 0], [0, .1, 0], .001, [.7, .5, .3]);
  }
  assert(draws.every(d => d.vertices.every(Number.isFinite)));
  return { faceHash, bodyTriangles: draws.reduce((sum, d) => sum + d.triangles, 0) };
}
function instrumentMesh(file, source) {
  const c = { window: {} }; vm.createContext(c);
  if (file.includes('cello')) vm.runInContext(fs.readFileSync('dist/instruments/cello-fingering.js', 'utf8'), c);
  vm.runInContext(source, c);
  const mesh = c.window[file.includes('cello') ? 'CelloModel' : 'ViolinModel'].BODY_MESH;
  const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (let i = 0; i < mesh.length; i += 6) for (let j = 0; j < 3; j++) {
    bounds[0][j] = Math.min(bounds[0][j], mesh[i + j]);
    bounds[1][j] = Math.max(bounds[1][j], mesh[i + j]);
  }
  assert(mesh.every(Number.isFinite));
  return { triangles: mesh.length / 18, bounds };
}
const modelFiles = ['dist/instruments/violin-model.js', 'dist/instruments/cello-model.js'];
const files = ['dist/gl.js', 'dist/instruments/violin-gl.js'];
if (process.argv[2] === '--baseline') {
  // node geometry-test.cjs --baseline /path/to/reviewed/pre-reduction/renderers
  assert(process.argv[3], 'Supply a reviewed baseline renderer directory');
  const baseline = Object.fromEntries(files.map(file => [file, inspect(fs.readFileSync(process.argv[3] + '/' + file.split('/').at(-1), 'utf8'))]));
  for (const file of modelFiles) baseline[file] = instrumentMesh(file, fs.readFileSync(process.argv[3] + '/' + file.split('/').at(-1), 'utf8'));
  fs.writeFileSync('geometry-baseline.json', JSON.stringify(baseline, null, 2) + '\n');
} else {
  const baseline = JSON.parse(fs.readFileSync('geometry-baseline.json', 'utf8'));
  const report = {};
  for (const file of files) {
    const result = inspect(fs.readFileSync(file, 'utf8'));
    assert.equal(result.faceHash, baseline[file].faceHash, file + ': face geometry, normals, transforms or colors changed');
    assert(result.bodyTriangles < baseline[file].bodyTriangles * .6, file + ': body budget regressed');
    report[file] = { faceUnchanged: true, before: baseline[file].bodyTriangles, after: result.bodyTriangles };
  }
  for (const file of modelFiles) {
    const result = instrumentMesh(file, fs.readFileSync(file, 'utf8'));
    assert(result.triangles < baseline[file].triangles * .4, file + ': instrument budget regressed');
    for (let end = 0; end < 2; end++) for (let axis = 0; axis < 3; axis++)
      assert(Math.abs(result.bounds[end][axis] - baseline[file].bounds[end][axis]) < .002, file + ': body silhouette bounds changed');
    report[file] = { before: baseline[file].triangles, after: result.triangles, boundsPreservedWithinMm: 2 };
  }
  for (const file of ['dist/app.js', 'dist/instruments/guitar-model.js', 'dist/instruments/violin-model.js', 'dist/instruments/cello-motion.js']) {
    const source = fs.readFileSync(file, 'utf8'), begin = source.indexOf('R.setFaceDetail?.(true)'), head = source.indexOf("R.piece('head'"), end = source.indexOf('R.setFaceDetail?.(false)', begin);
    assert(begin >= 0 && begin < head && end > head, file + ': face detail scope missing');
  }
  console.log(JSON.stringify(report));
}
