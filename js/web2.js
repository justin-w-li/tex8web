// web2: MathJax's TeX input, adjusted to draw math at the sizes TeX does.
// web2-page.tex sets window.web2 to lengths from the document, in ems of
// its body font, before this file and MathJax load:
//   exscale: the math extension font's size (TeX draws \big delimiters and
//     large operators from it at its design size, 10pt, also in an 11pt
//     document)
//   baselineskip, jot: rows of arrays and alignments
//   pt: 1pt (MathJax reads pt as a tenth of an em)
(function () {
  const tex = window.web2;
  const config = window.MathJax = window.MathJax || {};
  const startup = config.startup = config.startup || {};

  // \big and co.: delimiters of TeX's sizes (MathJax asks for 1.2em and up,
  // just above the glyph it has for \big, which then comes out a size larger)
  const bigSizes = {big: 1.19, Big: 1.79, bigg: 2.39, Bigg: 2.99};
  function sizeBigDelimiters() {
    const macros = MathJax._.input.tex.MapHandler.MapHandler.getMap('macros');
    const factor = macros.lookup('big')._args[1] / 1.2;  // MathJax's size per em
    for (const [name, size] of Object.entries(bigSizes)) {
      for (const suffix of ['', 'l', 'r', 'm']) {
        const token = macros.lookup(name + suffix);
        if (token) token._args[1] = size * factor;
      }
    }
  }

  // MathJax's default space between rows (in its ems, in which 1pt is
  // 0.1em), and TeX's struts and space, for each environment
  const alignment = {rowspacing: 0.3, stretch: 1, space: () => tex.jot};
  const array = {rowspacing: 0.4, stretch: 1, space: () => 0};
  const environments = {
    align: alignment, 'align*': alignment, alignat: alignment, 'alignat*': alignment,
    flalign: alignment, 'flalign*': alignment, gather: alignment, 'gather*': alignment,
    aligned: alignment, alignedat: alignment, gathered: alignment, split: alignment,
    multline: {...alignment, rowspacing: 0.5}, 'multline*': {...alignment, rowspacing: 0.5},
    array: array, matrix: array, pmatrix: array, bmatrix: array, Bmatrix: array,
    vmatrix: array, Vmatrix: array,
    // (amsmath's cases sets \arraystretch to 1.2, and has two columns
    // a \quad apart, also when the second is empty)
    cases: {rowspacing: 0.2, stretch: 1.2, space: () => 0, columns: 2},
    dcases: {rowspacing: 0.2, stretch: 1.2, space: () => 0, columns: 2},
    rcases: {rowspacing: 0.2, stretch: 1.2, space: () => 0},
  };

  // the environment of each table, which MathJax doesn't record (an
  // mtable's data-latex holds its source with macros expanded): wrap the
  // environments' functions to mark the tables they make
  function markEnvironments(parseOptions) {
    for (const {item} of parseOptions.handlers.get('environment')._configuration.items) {
      for (const [name, token] of item.map || []) {
        const make = token._func;
        token._func = function (parser, begin, ...args) {
          const result = make.call(this, parser, begin, ...args);
          if (result && result.arraydef) result.arraydef['data-web2-env'] = name;
          return result;
        };
      }
    }
  }

  function environment(mtable) {
    return environments[mtable.attributes.get('data-web2-env')];
  }

  function ems(length) {
    const [, value, unit] = String(length).match(/^([-\d.]+)(em|pt)?$/) || [, 0];
    return unit === 'pt' ? value / 10 : +value;
  }

  // rows on struts, 0.7 and 0.3 of the baselineskip (times \arraystretch)
  // above and below the baseline, and the space between them TeX's, plus
  // any \\[..]
  function spaceRows(mtable, env, factory) {
    const em = n => n.toFixed(3) + 'em';
    for (const row of mtable.childNodes) {
      const cell = row.childNodes[row.isKind('mlabeledtr') ? 1 : 0];
      if (!cell) continue;
      const strut = factory.create('node', 'mspace', [], {
        width: '0em',
        height: em(0.7 * tex.baselineskip * env.stretch),
        depth: em(0.3 * tex.baselineskip * env.stretch),
      });
      cell.childNodes[0].childNodes.unshift(strut);
      strut.parent = cell.childNodes[0];
    }
    const row = mtable.childNodes[0];
    if (row && env.columns > Math.max(...mtable.childNodes.map(row => row.childNodes.length))) {
      row.appendChild(factory.create('node', 'mtd'));
    }
    const spacing = String(mtable.attributes.get('rowspacing')).split(/\s+/).map(space =>
      em(Math.max(0, (ems(space) - env.rowspacing) * 10 * tex.pt + env.space())));
    mtable.attributes.set('rowspacing', spacing.join(' '));
  }

  const bars = ['|', '‖', '∥'];
  let TEXCLASS;

  function adjust({data}) {
    const factory = data.nodeFactory;
    const scale = (100 * tex.exscale).toFixed(1) + '%';
    const operators = [];
    data.root.walkTree(node => {
      if (node.isKind('mtable')) {
        const env = environment(node);
        if (env) spaceRows(node, env, factory);
      } else if (node.isKind('mo')) {
        // inline math breaks after a relation or binary operator, as in TeX
        if (node.texClass === TEXCLASS.REL || node.texClass === TEXCLASS.BIN) {
          node.attributes.set('linebreakstyle', 'after');
        }
        const minsize = node.attributes.getExplicit('minsize');
        if (minsize) {
          node.attributes.set('mathsize', scale);
          // TeX builds a big bar from pieces, a little (0.04em) taller
          // than the glyphs of the other delimiters
          if (bars.includes(node.getText())) {
            const size = (ems(minsize) + 0.04 / tex.exscale).toFixed(3) + 'em';
            node.attributes.set('minsize', size);
            node.attributes.set('maxsize', size);
          }
        } else if (node.attributes.get('largeop')) {
          operators.push(node);
        }
      }
    });
    // large operators: scaled around them, as MathJax misplaces the limits
    // of \int (tucked into its slant) when the <mo> itself is scaled
    for (const mo of operators) {
      const parent = mo.parent;
      const style = factory.create('node', 'mstyle', [], {mathsize: scale});
      parent.replaceChild(style, mo);
      style.childNodes[0].appendChild(mo);
    }
  }

  const ready = startup.ready;
  startup.ready = function () {
    sizeBigDelimiters();
    if (ready) ready(); else MathJax.startup.defaultReady();
    TEXCLASS = MathJax._.core.MmlTree.MmlNode.TEXCLASS;
    const input = MathJax.startup.document.inputJax.find(jax => jax.name === 'TeX');
    markEnvironments(input.parseOptions);
    input.postFilters.add(adjust);
  };
})();
