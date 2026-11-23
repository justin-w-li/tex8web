// tex8web: MathJax's TeX input, adjusted to draw math at the sizes TeX does
// (CONTRIBUTING.md, "MathJax sizes"). tex8web(config, tex) returns MathJax's
// configuration with the adjustments hooked in. tex holds lengths from the
// document, in ems of its body font (tex8web-page.tex):
//   exscale: the math extension font's size (TeX draws \big delimiters and
//     large operators from it at its design size, 10pt, also in an 11pt
//     document)
//   baselineskip, jot: rows of arrays and alignments
//   arraycolsep: the columns of arrays and matrices
//   pt: 1pt (MathJax reads pt as a tenth of an em)
// In a page, this file configures MathJax from the page's tex8web-config
// (at the end); prerender.mjs calls tex8web() itself.
//
// Code marked "internal" uses MathJax's internals, so MathJax's version is
// pinned in package.json.
function tex8web(config, tex) {
  const startup = config.startup = config.startup || {};
  const loader = config.loader = config.loader || {};

  // \big and co.: delimiters of TeX's sizes. MathJax asks for 1.2em and up,
  // a little above its glyph for \big, which then comes out a size larger.
  const bigSizes = {big: 1.19, Big: 1.79, bigg: 2.39, Bigg: 2.99};
  function sizeBigDelimiters() {
    // (internal: the macro map, and a macro's arguments)
    const macros = MathJax._.input.tex.MapHandler.MapHandler.getMap('macros');
    const factor = macros.lookup('big')._args[1] / 1.2;  // MathJax's size per em
    for (const [name, size] of Object.entries(bigSizes)) {
      for (const suffix of ['', 'l', 'r', 'm']) {
        const token = macros.lookup(name + suffix);
        if (token) token._args[1] = size * factor;
      }
    }
  }

  // each table row as high as MathJax means it to be. MathJax adds the rule
  // below a row to the row's height, and the last row has none (internal:
  // the table wrapper's rLines, one short). The last row's height is then
  // NaN, which Node writes as NaNem and a browser ignores, keeping any height
  // the row had from an earlier rendering.
  function fixRowHeights() {
    const Mtable = MathJax._.output.chtml.Wrappers.mtable.ChtmlMtable.prototype;
    const updateRowHeights = Mtable.updateRowHeights;
    Mtable.updateRowHeights = function () {
      const lines = this.rLines;
      this.rLines = [...lines, 0];
      updateRowHeights.call(this);
      this.rLines = lines;
    };
  }

  // how far right the content of the boxes of no width in a table's rows
  // reaches, from the table's left edge
  function lapEnd(table, numbered) {
    const widths = table.getComputedWidths(), spacing = table.getColumnHalfSpacing();
    let end = 0;
    for (const row of table.tableRows) {
      if (numbered && !row.node.isKind('mlabeledtr')) continue;
      let x = 0;
      row.tableCells.forEach((cell, i) => {
        x += spacing[i];
        const content = cell.childNodes[0];
        const align = cell.node.attributes.get('columnalign');
        const at = x + (widths[i] - content.getOuterBBox().w) * (align === 'right' ? 1 : align === 'center' ? 0.5 : 0);
        end = Math.max(end, lapReach(content, at, 1));
        x += widths[i] + spacing[i + 1];
      });
    }
    return end;
  }
  // the same in math that starts at `at`, whose ems are `scale` of the
  // table's: in groups, as the TeXAtom around \rlap's box, and in a table,
  // as a split in an equation. A child starts after the space before it
  // (L, as an operator's lspace) and is followed by the space after it
  // (R). \llap's box, which has an lspace, ends where it stands, and so
  // does the box of \vphantom or \mathstrut, whose mphantom draws nothing.
  function lapReach(wrapper, at, scale) {
    const node = wrapper.node;
    if (node.isKind('mtable')) return at + lapEnd(wrapper, false) * scale;
    if (node.isKind('mpadded')) {
      const content = wrapper.childNodes[0];
      const lapped = String(node.attributes.get('width')) === '0' && !node.attributes.getExplicit('lspace')
        && !content.node.childNodes[0]?.isKind('mphantom');
      return lapped ? at + content.getOuterBBox().w * scale : at;
    }
    if (!['mrow', 'mstyle', 'TeXAtom'].some(kind => node.isKind(kind))) return at;
    let end = at;
    for (const child of wrapper.childNodes) {
      const box = child.getOuterBBox(), childScale = scale * box.rscale;
      end = Math.max(end, lapReach(child, at + box.L * childScale, childScale));
      at += (box.L + box.w + box.R) * childScale;
    }
    return end;
  }
  // a \lefteqn (macros.lua: an mpadded of no width) on a numbered row of
  // an alignment, kept clear of the numbers on a narrow screen. MathJax
  // sizes the table by its columns, so the content of the box may run past
  // the table's right edge, under the number. The table gets that much
  // more room on its right. It stays centered while there is room, as in
  // the PDF, and is moved left when there is not (internal: the wrappers'
  // boxes, the table's spacing, and handleDisplay, which gives a numbered
  // table its width). A row without a number may run into the margin, as
  // in the PDF. A table as wide as the line, as in flalign and multline,
  // is left as MathJax sets it, with its columns spread over the line as
  // in the PDF.
  function clearNumbers() {
    const Wrapper = MathJax._.output.chtml.Wrappers.math.ChtmlMath.prototype;
    const handleDisplay = Wrapper.handleDisplay;
    Wrapper.handleDisplay = function (parent) {
      handleDisplay.call(this, parent);
      const table = this.jax.table;
      if (!table?.hasLabels || table.node.attributes.get('data-width-includes-label')) return;
      const over = lapEnd(table, true) - table.getBBox().w;
      if (over <= 0) return;
      const {L, w, R} = table.getOuterBBox();
      const adaptor = this.adaptor, mtable = table.dom[0], inner = adaptor.firstChild(mtable);
      adaptor.setStyle(mtable, 'min-width', table.em(L + w + over + R));
      // The left margin places the table: centered, or far enough left for
      // the content and the numbers. The right margin keeps that room in
      // an equation's preview, which sets the left margin to 0.
      adaptor.setStyle(mtable, 'text-align', 'left');
      adaptor.setStyle(inner, 'margin-left', `clamp(${table.em(L)}, (100% - ${table.em(w)}) / 2, 100% - ${table.em(w + over + R)})`);
      adaptor.setStyle(inner, 'margin-right', table.em(over + R));
    };
  }

  // \color[model]{values}: MathJax's color extension knows the models rgb,
  // RGB, and gray. Once it has loaded, xcolor's HTML, Gray, cmy, and cmyk
  // are added, converted to RGB as xcolor does (internal: the extension's
  // ColorModel, whose models are private to it, and its TexError).
  const decimal = max => v => /^(\d+(\.\d*)?|\.\d+)$/.test(v) && v <= max;
  const colorModels = {
    HTML: {count: 1, valid: v => /^[0-9A-Fa-f]{6}$/.test(v),
      rgb: ([hex]) => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)},
    Gray: {count: 1, valid: decimal(15), rgb: ([g]) => [g / 15, g / 15, g / 15]},
    cmy: {count: 3, valid: decimal(1), rgb: ([c, m, y]) => [1 - c, 1 - m, 1 - y]},
    cmyk: {count: 4, valid: decimal(1), rgb: ([c, m, y, k]) => [c, m, y].map(x => 1 - Math.min(1, +x + +k))},
  };
  loader['[tex]/color'] = {...loader['[tex]/color'], ready: addColorModels};
  function addColorModels() {
    const {ColorModel} = MathJax._.input.tex.color.ColorUtil;
    const TexError = MathJax._.input.tex.TexError.default;
    const normalizeColor = ColorModel.prototype.normalizeColor;
    ColorModel.prototype.normalizeColor = function (model, value) {
      const spec = colorModels[model];
      if (!spec) return normalizeColor.call(this, model, value);
      const values = value.trim().split(/\s*,\s*/);
      if (values.length !== spec.count || !values.every(spec.valid)) {
        throw new TexError('BadColorValue', 'Invalid color values for the %1 model', model);
      }
      const bytes = spec.rgb(values).map(x => Math.round(255 * x).toString(16).padStart(2, '0'));
      return '#' + bytes.join('');
    };
  }

  // MathJax's default space between rows (in its ems, in which 1pt is
  // 0.1em), and TeX's struts and space, for each environment.
  // tex8web-math.tex lists the environments it numbers.
  const alignment = {rowspacing: 0.3, stretch: 1, space: tex.jot};
  // In arrays and matrices, \arraycolsep is on each side of a column
  // (colsep), and also at an array's edges (edges).
  const matrix = {rowspacing: 0.4, stretch: 1, space: 0, colsep: true};
  const array = {...matrix, edges: true};
  // mathtools' cases environments set rows on struts with \jot between
  // them, as an alignment does. Their \quad starts the second column, so
  // it is there only when a row has a second cell, as in MathJax
  // (mathtools.sty, \MT_start_cases:nnnn).
  const mathtoolsCases = {...alignment, rowspacing: 0.2};
  const environments = {
    align: alignment, 'align*': alignment, alignat: alignment, 'alignat*': alignment,
    flalign: alignment, 'flalign*': alignment, gather: alignment, 'gather*': alignment,
    aligned: alignment, alignedat: alignment, gathered: alignment, split: alignment,
    // LaTeX's eqnarray sets its rows a \baselineskip and \jot apart
    // (\@xeqncr, latex.ltx)
    eqnarray: alignment, 'eqnarray*': alignment,
    multline: {...alignment, rowspacing: 0.5}, 'multline*': {...alignment, rowspacing: 0.5},
    array: array, matrix: matrix, pmatrix: matrix, bmatrix: matrix, Bmatrix: matrix,
    vmatrix: matrix, Vmatrix: matrix,
    'matrix*': matrix, 'pmatrix*': matrix, 'bmatrix*': matrix, 'Bmatrix*': matrix,
    'vmatrix*': matrix, 'Vmatrix*': matrix,
    // amsmath's cases sets \arraystretch to 1.2, and has two columns a
    // \quad apart, also when the second is empty
    cases: {rowspacing: 0.2, stretch: 1.2, space: 0, columns: 2},
    'cases*': mathtoolsCases, dcases: mathtoolsCases, 'dcases*': mathtoolsCases,
    rcases: mathtoolsCases, 'rcases*': mathtoolsCases,
    drcases: mathtoolsCases, 'drcases*': mathtoolsCases,
  };

  // the environment of each table, which MathJax does not record (an
  // mtable's data-latex holds its source with macros expanded): the
  // environments' functions are wrapped to mark the tables they make
  function markEnvironments(parseOptions) {
    // internal: the environment handlers, and their functions
    for (const {item} of parseOptions.handlers.get('environment')._configuration.items) {
      for (const [name, token] of item.map || []) {
        const make = token._func;
        token._func = function (parser, begin, ...args) {
          const result = make.call(this, parser, begin, ...args);
          if (result && result.arraydef) result.arraydef['data-tex8web-env'] = name;
          return result;
        };
      }
    }
  }

  function environment(mtable) {
    return environments[mtable.attributes.get('data-tex8web-env')];
  }

  function ems(length) {
    const [, value, unit] = String(length).match(/^([-\d.]+)(em|pt)?$/) || [, 0];
    return unit === 'pt' ? value / 10 : +value;
  }

  // rows on struts, 0.7 and 0.3 of the baselineskip (times \arraystretch)
  // above and below the baseline, with TeX's space between rows, plus any
  // \\[..]
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
      em(Math.max(0, (ems(space) - env.rowspacing) * 10 * tex.pt + env.space)));
    mtable.attributes.set('rowspacing', spacing.join(' '));
  }

  // TeX's \arraycolsep where MathJax has its 0.5em on each side of a
  // column: 1em between columns, 0.5em at a !{} column, and 0.5em at an
  // array's edges, written as data-array-padding only where an edge has
  // @{}. An @{} column is a column of its own, with 0 around it, so the
  // space that the source sets is kept.
  function spaceColumns(mtable, env) {
    const sep = {'1em': 2 * tex.arraycolsep, '.5em': tex.arraycolsep};
    const space = list => String(list).split(/\s+/)
      .map(s => s in sep ? sep[s].toFixed(3) + 'em' : s).join(' ');
    mtable.attributes.set('columnspacing', space(mtable.attributes.get('columnspacing')));
    if (env.edges) {
      const padding = mtable.attributes.getExplicit('data-array-padding') ?? '.5em .5em';
      mtable.attributes.set('data-array-padding', space(padding));
    }
  }

  // colors (\color, \colorbox, \fcolorbox: mathcolor, mathbackground, and a
  // border in style) at another lightness in dark mode (css/tex8web.css's
  // --tex8web-dark-*). Black text takes the text's color.
  const lightDark = (color, property) =>
    `light-dark(${color}, oklch(from ${color} var(--tex8web-dark-${property}) c h))`;
  const text = color => /^(black|#000000)$/i.test(color) ? 'var(--tex8web-text)' : lightDark(color, 'color');
  function darken(node) {
    const color = node.attributes.getExplicit('mathcolor');
    if (color) node.attributes.set('mathcolor', text(color));
    // \rule is an mspace with a background, drawn in the text's color
    const background = node.attributes.getExplicit('mathbackground');
    if (background) {
      node.attributes.set('mathbackground',
        node.isKind('mspace') ? text(background) : lightDark(background, 'background'));
    }
    const style = node.attributes.getExplicit('style');
    if (style?.startsWith('border: ')) {
      node.attributes.set('style', style.replace(/^(border: \S+ solid )([^;]+)/,
        (_, border, color) => border + lightDark(color, 'border')));
    }
  }

  const bars = ['|', '‖', '∥'];
  const wideAccents = ['^', '~'];
  let TEXCLASS;

  // \mathclap or \clap around a whole display, or around the one cell of a
  // numbered row (mathtools.js: an mpadded of no width, moved left by half
  // its content), given its content's width. The content is centered in
  // the display as in the PDF, and one wider than the column starts at the
  // display's left edge, where it can be scrolled to. A clap inside a
  // larger formula keeps its zero width.
  function unclap(node) {
    for (;;) {
      if (node.isKind('mlabeledtr') && node.childNodes.length === 2) node = node.childNodes[1];
      else if (node.childNodes.length === 1
          && ['math', 'mrow', 'TeXAtom', 'mstyle', 'mtable', 'mtr', 'mtd'].some(kind => node.isKind(kind))) node = node.childNodes[0];
      else break;
    }
    if (node.isKind('mpadded') && String(node.attributes.getExplicit('width')) === '0'
        && node.attributes.getExplicit('lspace') === '-.5width') {
      node.attributes.unset('width');
      node.attributes.unset('lspace');
    }
  }

  function adjust({math, data}) {
    if (math.display) unclap(data.root);
    const factory = data.nodeFactory;
    const scale = (100 * tex.exscale).toFixed(1) + '%';
    const operators = [];
    data.root.walkTree(node => {
      darken(node);
      if (node.isKind('mtable')) {
        const env = environment(node);
        if (env) spaceRows(node, env, factory);
        if (env?.colsep) spaceColumns(node, env);
      } else if (node.isKind('mspace') && !math.display && node.attributes.getExplicit('width')
          && !node.attributes.getExplicit('linebreak')) {
        // inline math never breaks at a space, such as the \, between a
        // number and its unit, as TeX never breaks a formula at glue
        // (\allowbreak is a space without a width)
        node.attributes.set('linebreak', 'nobreak');
      } else if (node.isKind('mo')) {
        // inline math breaks after a relation or binary operator, as in TeX
        if (node.texClass === TEXCLASS.REL || node.texClass === TEXCLASS.BIN) {
          node.attributes.set('linebreakstyle', 'after');
        }
        const minsize = node.attributes.getExplicit('minsize');
        if (node.getProperty('mathaccent') && wideAccents.includes(node.getText())
            && node.attributes.getExplicit('stretchy') !== false) {
          // \widehat and \widetilde: the widest of TeX's sizes (0.556, 1,
          // and 1.444em) not wider than the base, or else the narrowest.
          // Internal, getStretchedVariant: an accent takes the size before
          // the first one at least as wide as its base, that width clamped
          // to minsize and maxsize, hence bounds a little above the font's
          // narrowest wide size and 1.444em. The narrowest is 0.556em in
          // Latin Modern Math, which has the TeX font's sizes
          // (matchModernFont), and about 0.6em in the TeX Gyre fonts. A
          // bound below it gives a narrow base \hat's glyph (internal: the
          // font's getDelimiter). Without bounds, MathJax aims wider than
          // the base, among sizes from \hat's 0.5em to 1.889em.
          const narrowest = MathJax.startup.output.font.getDelimiter(node.getText().codePointAt(0)).sizes[1];
          node.attributes.set('minsize', (narrowest + 0.001).toFixed(3) + 'em');
          node.attributes.set('maxsize', '1.445em');
        } else if (minsize) {
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
    // large operators: scaled by an mstyle around them, because MathJax
    // misplaces the limits of \int (tucked into its slant) when the <mo>
    // itself is scaled
    for (const mo of operators) {
      const parent = mo.parent;
      const style = factory.create('node', 'mstyle', [], {mathsize: scale});
      parent.replaceChild(style, mo);
      style.childNodes[0].appendChild(mo);
    }
  }

  // the parts of an alignment split at \intertext (tex8web-math.tex), each a
  // formula with \webalignment{n} at its start: the same columns in each,
  // each column as wide as in its widest part, so the parts line up as
  // TeX's one alignment does
  function markAlignment(math) {
    math.math = math.math.replace(/\\webalignment\s*\{(\d+)\}/, (_, n) => {
      math.tex8webAlignment = n;
      // internal: ui/lazy's flags, which would leave the formula uncompiled
      // until it is in view
      math.lazyCompile = math.lazyTypeset = false;
      return '';
    });
  }
  function markAlignments(doc) {
    for (const math of doc.math) markAlignment(math);
  }
  // the top table of a part (none if MathJax could not parse it), and its
  // columns' widths (internal: its wrapper, made as getBBox makes it, with
  // the TeX classes that space operators, and a container for measuring
  // text)
  function measure(math, doc) {
    const jax = doc.outputJax;
    jax.setDocument(doc);
    jax.math = math;
    jax.container = jax.createNode();
    math.root.setTeXclass(null);
    jax.nodeMap = new Map();
    const wrappers = [jax.factory.wrap(math.root)];
    let table;
    while (!table && wrappers.length) {
      const wrapper = wrappers.shift();
      if (wrapper.node.isKind('mtable')) table = wrapper;
      else wrappers.push(...wrapper.childNodes);
    }
    jax.nodeMap = null;
    return table && {node: table.node, widths: table.getComputedWidths()};
  }
  function alignColumns(doc) {
    const alignments = {};
    for (const math of doc.math) {
      if (math.tex8webAlignment) (alignments[math.tex8webAlignment] ||= []).push(math);
    }
    for (const parts of Object.values(alignments)) {
      // once per compiled formula: ui/lazy and the menu render the page
      // again, and the widths would then be the ones set here
      if (parts.every(math => math.root.getProperty('tex8web-columns'))) continue;
      parts.forEach(math => math.root.setProperty('tex8web-columns', true));
      const tables = parts.map(math => measure(math, doc)).filter(Boolean);
      if (!tables.length) continue;
      const widths = [];
      for (const table of tables) {
        table.widths.forEach((width, i) => { widths[i] = Math.max(widths[i] || 0, width); });
      }
      // A part with fewer columns gets the columns of the part with the
      // most, with their spacing and alignment, which MathJax sets per
      // table. flalign's spacers stay as wide as the room left.
      const most = tables.find(table => table.widths.length === widths.length).node.attributes;
      const given = String(most.get('columnwidth')).split(' ');
      for (const {node, widths: own} of tables) {
        const row = node.childNodes[0];
        if (own.length < widths.length) {
          const cells = row.childNodes.length - (row.isKind('mlabeledtr') ? 1 : 0);
          for (let i = cells; i < widths.length; i++) row.appendChild(doc.mmlFactory.create('mtd'));
          for (const name of ['columnalign', 'columnspacing', 'data-break-align']) {
            node.attributes.set(name, most.getExplicit(name));
          }
        }
        // rounded up, so that a cell's content fits
        node.attributes.set('columnwidth', widths.map((w, i) =>
          given[i] === 'fit' ? 'fit' : Math.ceil(w * 1000) / 1000 + 'em').join(' '));
      }
    }
  }

  // in the options, as the menu may make the document anew: before compile
  // (20), and after the metrics (110), which the widths need
  const options = config.options = config.options || {};
  options.renderActions = {
    ...options.renderActions,
    tex8webAlignment: [15, markAlignments, markAlignment],
    tex8webColumns: [115, alignColumns, () => {}],
  };

  // macros.lua's definitions (the page's #tex8web-macros, as text), given
  // to MathJax before any math, which ui/lazy may typeset in any order
  // (internal: ui/lazy compiles math without a node, such as tex2mml's, at
  // once). Given as a promise, because a \definecolor loads the color
  // extension. A TeX error in one definition leaves the ones after it
  // undefined.
  const pageReady = startup.pageReady;
  startup.pageReady = async function () {
    const doc = MathJax.startup.document;
    const [macros] = doc.adaptor.getElements(['#tex8web-macros'], doc.document);
    const mml = macros ? await MathJax.tex2mmlPromise(doc.adaptor.textContent(macros)) : '';
    if (mml.includes('<merror')) console.warn('tex8web: a TeX error in a macro definition:', mml);
    return pageReady ? pageReady() : MathJax.startup.defaultPageReady();
  };

  // \text, \mbox, and \hbox in text, as in \text{\text{E}},
  // \textbf{\text{E}}, \text{a \mbox{b}}, or a macro whose body is one of
  // them used in \text: LaTeX sets the argument in the font around it.
  // MathJax's textmacros reads the argument of \text as text, where these
  // are "only supported in math mode". tex8web-text gives them there as
  // groups (internal: textmacros' Macro method, and the Configuration and
  // CommandMap of a package).
  const texOptions = config.tex = config.tex || {};
  const textmacros = texOptions.textmacros = texOptions.textmacros || {};
  textmacros.packages = {'[+]': ['tex8web-text']};
  function addTextInText() {
    const {Configuration} = MathJax._.input.tex.Configuration;
    const {CommandMap} = MathJax._.input.tex.TokenMap;
    const {TextMacrosMethods} = MathJax._.input.tex.textmacros.TextMacrosMethods;
    const group = [TextMacrosMethods.Macro, '{#1}', 1];
    new CommandMap('tex8web-text', {text: group, mbox: group, hbox: group});
    Configuration.create('tex8web-text', {parser: 'text', handler: {macro: ['tex8web-text']}});
  }

  // \hidewidth: a cell narrower than its column goes to the side away from
  // it, as in the PDF, where its fill glue is stronger than the column's
  // \hfil. MathJax's \hfill does this at a cell's start or end (internal:
  // an ArrayItem's hfill, read when the cell ends), but is an error outside
  // a table. A style command, such as \scriptstyle or the \displaystyle of
  // a column's template, opens a StyleItem over the cell that closes only
  // when the cell ends, into one mstyle. Under such items, \hidewidth is
  // at the cell's start when they and the cell are empty, and at its end
  // when nothing follows it in them: each item notes, when it closes,
  // whether \hidewidth ends it, for the item below.
  const packages = texOptions.packages = texOptions.packages || {};
  (packages['[+]'] = packages['[+]'] || []).push('tex8web-hidewidth');
  function addHidewidth() {
    const {Configuration} = MathJax._.input.tex.Configuration;
    const {CommandMap} = MathJax._.input.tex.TokenMap;
    const {ArrayItem, StyleItem} = MathJax._.input.tex.base.BaseItems;
    new CommandMap('tex8web-hidewidth', {hidewidth(parser) {
      const styles = [];
      let item = parser.stack.Top();
      while (item instanceof StyleItem) {
        styles.push(item);
        item = parser.stack.Top(styles.length + 1);
      }
      if (!(item instanceof ArrayItem)) return;
      if (!styles.length) {
        item.hfill.push(item.Size());
        return;
      }
      if (!item.Size() && styles.every(style => !style.Size())) item.hfill.push(0);
      styles.forEach((style, i) => style.hidewidthBelow = styles[i + 1] || item);
      styles[0].hidewidthEnd = styles[0].Size();
    }});
    const checkItem = StyleItem.prototype.checkItem;
    StyleItem.prototype.checkItem = function (item) {
      const below = this.hidewidthBelow;
      if (item.isClose && below && this.hidewidthEnd === this.Size()) {
        if (below instanceof ArrayItem) below.hfill.push(below.Size() + 1);
        else below.hidewidthEnd = below.Size() + 1;
      }
      return checkItem.call(this, item);
    };
    Configuration.create('tex8web-hidewidth', {handler: {macro: ['tex8web-hidewidth']}});
  }

  // Latin Modern Math, MathJax's mathjax-modern, is the math font of a
  // document in Computer Modern (tex8web-math.tex), as it matches the
  // text's Latin Modern. Where version 4.1.3 differs from the PDF, it is
  // changed here, on the font's class before MathJax makes the font
  // (internal: the class, its addExtension, defaultChars, dynamicFiles, and
  // defaultStyles, and AddFontIds). The page checks are in test-mathfont.tex.
  function matchModernFont() {
    if (MathJax.config.output.font !== 'mathjax-modern') return;
    const Font = MathJax._.output.fonts['mathjax-modern'].chtml_ts.MathJaxModernFont;
    const {AddFontIds} = MathJax._.output.chtml.DynamicFonts;
    // another MathJax font's files, from beside mathjax-modern's: on a CDN,
    // the path holds MathJax's version
    const path = MathJax.config.loader.paths['mathjax-modern'];
    const fontURL = name => MathJax._.components.package.Package.resolvePath(
      path.replace('mathjax-modern-font', `mathjax-${name}-font`) + '/chtml/woff2', false);

    // Accents: mathjax-modern's skews and combining offsets (dx) are wrong
    // and set an accent off center, as a skew of 0.303em on the italic a,
    // where TeX has 0.022em. New Computer Modern, MathJax's default font,
    // whose data comes with tex-chtml.js, has TeX's. They are taken for
    // each character that is as wide in both fonts: from that data, or,
    // for the letters it lacks, which are in New Computer Modern's dynamic
    // files, from the table below, a number for a skew with no offset.
    // They are set on mathjax-modern's characters as the font is made, and
    // on those of its dynamic files, loaded when one is first used, as each
    // file loads (internal: the class's dynamicSetup, which each dynamic
    // file calls with its characters).
    const dynamicSkews = {
      normal: {
        0x309: [0, .264], 0x30B: [0, .24], 0x30F: [0, .287], 0x311: [0, .264], 0x323: [0, .265], 0x326: [0, .264],
        0x32C: [0, .264], 0x32D: [0, .264], 0x32E: [0, .264], 0x32F: [0, .264], 0x330: [0, .264], 0x331: [0, .264],
        0x332: [0, .264], 0x333: [0, .264], 0x33F: [0, .264], 0x2017: 0, 0x20D3: -.264, 0x20D4: [0, .264],
        0x20D5: [0, .264], 0x20D8: -.264, 0x20E5: -.263, 0x20E6: -.264, 0x20E8: [0, .264], 0x20E9: [0, .264],
        0x20EA: -.264, 0x20EB: -.264, 0x20F0: [0, .26], 0x210C: .02, 0x2111: .138, 0x2113: .102, 0x2115: .022,
        0x211C: .08, 0x2128: .015, 0x212D: .064, 0x213C: 0, 0x213D: 0, 0x213E: .061, 0x213F: .028, 0x2140: .021,
        0x2145: .074, 0x2146: .051, 0x2147: .056, 0x2148: .071, 0xF6BE: .024, 0x1D4F6: .12, 0x1D504: .085,
        0x1D505: .032, 0x1D507: 0, 0x1D508: .027, 0x1D509: .062, 0x1D50A: -.038, 0x1D50D: .084, 0x1D50E: .074,
        0x1D50F: .073, 0x1D510: .138, 0x1D511: .121, 0x1D512: .048, 0x1D513: .102, 0x1D514: .042, 0x1D516: .017,
        0x1D517: .032, 0x1D518: .013, 0x1D519: .061, 0x1D51A: .117, 0x1D51B: .049, 0x1D51C: .057, 0x1D51E: 0,
        0x1D51F: -.096, 0x1D520: .025, 0x1D521: 0, 0x1D522: 0, 0x1D523: .029, 0x1D524: .013, 0x1D525: -.117,
        0x1D526: 0, 0x1D527: -.01, 0x1D528: -.042, 0x1D529: .025, 0x1D52A: .022, 0x1D52B: 0, 0x1D52C: .014,
        0x1D52D: .024, 0x1D52E: 0, 0x1D52F: 0, 0x1D530: 0, 0x1D531: -.015, 0x1D532: 0, 0x1D533: .029, 0x1D534: .026,
        0x1D535: .01, 0x1D536: .015, 0x1D537: -.01, 0x1D53D: .03, 0x1D54C: .053, 0x1D552: 0, 0x1D553: -.169,
        0x1D554: 0, 0x1D555: .17, 0x1D556: 0, 0x1D557: .028, 0x1D558: -.013, 0x1D559: -.147, 0x1D55A: 0, 0x1D55B: .057,
        0x1D55C: -.054, 0x1D55D: 0, 0x1D55E: .061, 0x1D55F: .06, 0x1D560: 0, 0x1D561: .076, 0x1D562: -.012, 0x1D563: 0,
        0x1D564: 0, 0x1D565: -.059, 0x1D566: .051, 0x1D567: .051, 0x1D568: .033, 0x1D569: .015, 0x1D56A: .062,
        0x1D56C: .082, 0x1D56D: 0, 0x1D56E: .218, 0x1D56F: -.033, 0x1D570: .207, 0x1D571: -.078, 0x1D572: .17,
        0x1D573: .071, 0x1D574: .073, 0x1D575: -.059, 0x1D576: .126, 0x1D577: .126, 0x1D578: .038, 0x1D579: .024,
        0x1D57A: -.087, 0x1D57B: .013, 0x1D57C: -.087, 0x1D57D: .011, 0x1D57E: 0, 0x1D57F: .153, 0x1D580: .104,
        0x1D581: 0, 0x1D582: .022, 0x1D583: .064, 0x1D584: 0, 0x1D585: -.169, 0x1D586: .087, 0x1D587: 0, 0x1D588: .081,
        0x1D589: -.105, 0x1D58A: .048, 0x1D58B: .072, 0x1D58C: .111, 0x1D58D: -.097, 0x1D58E: 0, 0x1D58F: 0,
        0x1D590: -.017, 0x1D591: .125, 0x1D592: -.056, 0x1D593: -.071, 0x1D594: .029, 0x1D595: -.124, 0x1D596: .112,
        0x1D597: .013, 0x1D598: 0, 0x1D599: .085, 0x1D59A: .011, 0x1D59B: -.142, 0x1D59C: -.296, 0x1D59D: .026,
        0x1D59E: -.127, 0x1D59F: 0, 0x1D5A0: 0, 0x1D5A1: -.077, 0x1D5A2: .091, 0x1D5A3: -.109, 0x1D5A4: .018,
        0x1D5A5: .025, 0x1D5A6: .073, 0x1D5A7: 0, 0x1D5A8: 0, 0x1D5A9: .109, 0x1D5AA: .02, 0x1D5AB: -.132, 0x1D5AC: 0,
        0x1D5AD: 0, 0x1D5AE: 0, 0x1D5AF: -.06, 0x1D5B0: 0, 0x1D5B1: -.066, 0x1D5B2: .015, 0x1D5B3: 0, 0x1D5B4: 0,
        0x1D5B5: 0, 0x1D5B6: 0, 0x1D5B7: -.015, 0x1D5B8: 0, 0x1D5B9: 0, 0x1D5BA: -.013, 0x1D5BB: -.139, 0x1D5BC: .042,
        0x1D5BD: .139, 0x1D5BE: .016, 0x1D5BF: .096, 0x1D5C0: .074, 0x1D5C1: -.14, 0x1D5C2: 0, 0x1D5C3: 0,
        0x1D5C4: -.124, 0x1D5C5: 0, 0x1D5C6: -.038, 0x1D5C7: -.038, 0x1D5C8: 0, 0x1D5C9: -.03, 0x1D5CA: .041,
        0x1D5CB: .034, 0x1D5CC: .022, 0x1D5CD: -.04, 0x1D5CE: 0, 0x1D5CF: 0, 0x1D5D0: 0, 0x1D5D1: 0, 0x1D5D2: 0,
        0x1D5D3: 0, 0x1D5D4: 0, 0x1D5D5: -.07, 0x1D5D6: .082, 0x1D5D7: -.096, 0x1D5D8: .015, 0x1D5D9: .022, 0x1D5DB: 0,
        0x1D5DC: 0, 0x1D5DD: .097, 0x1D5DE: .016, 0x1D5DF: -.126, 0x1D5E0: 0, 0x1D5E1: 0, 0x1D5E2: 0, 0x1D5E3: -.064,
        0x1D5E4: 0, 0x1D5E5: -.056, 0x1D5E6: 0, 0x1D5E7: 0, 0x1D5E8: 0, 0x1D5E9: 0, 0x1D5EB: -.015, 0x1D5EC: 0,
        0x1D5ED: 0, 0x1D5EE: 0, 0x1D5EF: -.152, 0x1D5F0: .041, 0x1D5F1: .152, 0x1D5F2: .011, 0x1D5F3: .088,
        0x1D5F5: -.153, 0x1D5F6: 0, 0x1D5F7: 0, 0x1D5F8: -.138, 0x1D5F9: 0, 0x1D5FA: -.028, 0x1D5FB: -.028, 0x1D5FC: 0,
        0x1D5FD: -.043, 0x1D5FE: .061, 0x1D5FF: .03, 0x1D600: .015, 0x1D601: -.047, 0x1D602: 0, 0x1D603: 0, 0x1D604: 0,
        0x1D605: 0, 0x1D606: 0, 0x1D607: 0, 0x1D608: .147, 0x1D609: .047, 0x1D60A: .179, 0x1D60B: .02, 0x1D60C: .097,
        0x1D60D: .094, 0x1D60E: .173, 0x1D60F: .107, 0x1D610: .107, 0x1D611: .208, 0x1D612: .095, 0x1D613: .016,
        0x1D614: .112, 0x1D615: .109, 0x1D616: .132, 0x1D617: .048, 0x1D618: .131, 0x1D619: .041, 0x1D61A: .125,
        0x1D61B: .061, 0x1D61C: .105, 0x1D61D: .045, 0x1D61E: .047, 0x1D61F: .061, 0x1D620: .036, 0x1D621: .084,
        0x1D622: .084, 0x1D623: 0, 0x1D624: .095, 0x1D625: .236, 0x1D626: .091, 0x1D627: .133, 0x1D628: .116,
        0x1D629: 0, 0x1D62A: .09, 0x1D62B: .102, 0x1D62C: -.022, 0x1D62D: .098, 0x1D62E: .057, 0x1D62F: .057,
        0x1D630: .079, 0x1D631: .05, 0x1D632: .125, 0x1D633: .068, 0x1D634: .08, 0x1D635: .042, 0x1D636: .083,
        0x1D637: .032, 0x1D638: .032, 0x1D639: .027, 0x1D63A: .032, 0x1D63B: .051, 0x1D63C: .144, 0x1D63D: .061,
        0x1D63E: .174, 0x1D63F: .033, 0x1D640: .097, 0x1D641: .093, 0x1D642: .167, 0x1D643: .105, 0x1D644: .105,
        0x1D645: .2, 0x1D646: .097, 0x1D647: .021, 0x1D648: .105, 0x1D649: .105, 0x1D64A: .13, 0x1D64B: .049,
        0x1D64C: .13, 0x1D64D: .054, 0x1D64E: .121, 0x1D64F: .066, 0x1D650: .105, 0x1D651: .046, 0x1D652: .045,
        0x1D653: .067, 0x1D654: .037, 0x1D655: .089, 0x1D656: .091, 0x1D657: -.025, 0x1D658: .098, 0x1D659: .233,
        0x1D65A: .086, 0x1D65B: .126, 0x1D65D: -.019, 0x1D65E: .078, 0x1D65F: .085, 0x1D660: -.033, 0x1D661: .083,
        0x1D662: .058, 0x1D663: .058, 0x1D664: .078, 0x1D665: .036, 0x1D666: .129, 0x1D667: .063, 0x1D668: .073,
        0x1D669: .038, 0x1D66A: .066, 0x1D66B: .031, 0x1D66C: .032, 0x1D66D: .029, 0x1D66E: .033, 0x1D66F: .051,
        0x1D670: 0, 0x1D671: -.073, 0x1D672: .1, 0x1D673: -.098, 0x1D674: 0, 0x1D675: 0, 0x1D676: .072, 0x1D677: 0,
        0x1D678: 0, 0x1D679: .085, 0x1D67A: 0, 0x1D67B: -.11, 0x1D67C: 0, 0x1D67D: 0, 0x1D67E: 0, 0x1D67F: -.07,
        0x1D680: 0, 0x1D681: -.097, 0x1D682: .046, 0x1D683: 0, 0x1D684: 0, 0x1D685: 0, 0x1D686: 0, 0x1D687: 0,
        0x1D688: 0, 0x1D689: 0, 0x1D68A: -.048, 0x1D68B: -.172, 0x1D68C: .043, 0x1D68D: .088, 0x1D68E: 0,
        0x1D68F: .077, 0x1D690: .07, 0x1D691: -.172, 0x1D692: 0, 0x1D693: .057, 0x1D694: -.169, 0x1D695: -.085,
        0x1D696: -.052, 0x1D697: -.071, 0x1D698: 0, 0x1D699: -.074, 0x1D69A: .044, 0x1D69B: -.018, 0x1D69C: .04,
        0x1D69D: -.074, 0x1D69E: -.043, 0x1D69F: 0, 0x1D6A0: 0, 0x1D6A1: 0, 0x1D6A2: 0, 0x1D6A3: 0, 0x1D756: 0,
        0x1D757: -.04, 0x1D75A: .015, 0x1D75B: 0, 0x1D75C: 0, 0x1D75E: 0, 0x1D75F: .012, 0x1D760: 0, 0x1D761: 0,
        0x1D762: 0, 0x1D763: 0, 0x1D764: 0, 0x1D765: 0, 0x1D766: -.034, 0x1D767: 0, 0x1D768: 0, 0x1D769: 0, 0x1D76B: 0,
        0x1D76C: -.015, 0x1D789: 0, 0x1D78B: .07, 0x1D78E: 0, 0x1D78F: .049, 0x1D790: .146, 0x1D791: .063,
        0x1D794: .09, 0x1D795: .082, 0x1D796: .097, 0x1D798: .097, 0x1D799: .088, 0x1D79A: .138, 0x1D79B: .098,
        0x1D79C: .097, 0x1D79D: .067, 0x1D79E: .111, 0x1D79F: .098, 0x1D7A0: .067, 0x1D7A1: .099, 0x1D7A2: .074,
        0x1D7A3: .056, 0x1D7A5: .103, 0x1D7A8: .098, 0x1D7C3: .1, 0x1D7C5: .19, 0x1D7C8: .084, 0x1D7C9: .109,
        0x1D7D8: 0, 0x1D7D9: 0, 0x1D7DA: 0, 0x1D7DB: 0, 0x1D7DC: .117, 0x1D7DD: 0, 0x1D7DE: 0, 0x1D7DF: .031,
        0x1D7E0: 0, 0x1D7E1: 0, 0x1D7E2: 0, 0x1D7E3: .01, 0x1D7E4: 0, 0x1D7E5: 0, 0x1D7E6: .073, 0x1D7E8: .084,
        0x1D7E9: 0, 0x1D7EA: 0, 0x1D7EB: 0, 0x1D7EC: 0, 0x1D7ED: 0, 0x1D7EE: -.016, 0x1D7EF: 0, 0x1D7F0: .068,
        0x1D7F1: 0, 0x1D7F2: .056, 0x1D7F3: 0, 0x1D7F4: 0, 0x1D7F5: -.016, 0x1D7F6: 0, 0x1D7F7: .015, 0x1D7F8: -.011,
        0x1D7F9: -.015, 0x1D7FA: .06, 0x1D7FB: 0, 0x1D7FC: .054, 0x1D7FD: -.184, 0x1D7FE: 0, 0x1D7FF: 0,
      },
      bold: {
        0xF6BE: .041,
      },
      italic: {
        0x30F: [0, .131],
      },
      'double-struck': {
        0x131: .201, 0x237: .181,
      },
      fraktur: {
        0x131: .272, 0x237: .177,
      },
      'bold-fraktur': {
        0x131: .301, 0x237: .476,
      },
      'sans-serif': {
        0x131: .277, 0x237: .157,
      },
      'bold-sans-serif': {
        0x131: .212, 0x237: .194, 0x300: [0, .203], 0x301: [0, .199], 0x302: [0, .261], 0x307: [0, .252],
        0x309: [0, .263], 0x30B: [0, .229], 0x30C: [0, .251], 0x30F: [0, .291], 0x323: [0, .262], 0x326: [0, .265],
      },
      'sans-serif-italic': {
        0x131: .205, 0x237: .117, 0x302: [0, .129], 0x306: [0, .092], 0x309: [0, .1], 0x30C: [0, .091],
        0x311: [0, .127], 0x326: [0, .278], 0x32E: [0, .255], 0x32F: [0, .29],
      },
      'sans-serif-bold-italic': {
        0x131: .313, 0x237: .195, 0x300: [0, .073], 0x301: [0, .069], 0x302: [0, .144], 0x307: [0, .12],
        0x309: [0, .117], 0x30B: [0, .101], 0x30C: [0, .103], 0x30F: [0, .164], 0x326: [0, .303], 0x32E: [0, .281],
        0x32F: [0, .296], 0x330: [0, .292],
      },
      monospace: {
        0x131: .208, 0x237: .345, 0x30F: [0, .261],
      },
      '-tex-variant': {
        0x2A: 0, 0x207F: .013,
      },
    };
    const skewed = (char, skew) => {
      const [sk, dx] = typeof skew === 'number' ? [skew, 0] : skew;
      return [...char.slice(0, 3), {...char[3], sk, dx}];
    };
    const newcm = MathJax._.output.chtml.DefaultFont.DefaultFont.defaultChars;
    const skews = {};
    for (const [variant, chars] of Object.entries(Font.defaultChars)) {
      for (const [n, char] of Object.entries(chars)) {
        const other = newcm[variant]?.[n];
        const skew = Array.isArray(other) && char[2] === other[2] ? [other[3]?.sk || 0, other[3]?.dx || 0]
          : dynamicSkews[variant]?.[n];
        if (!Array.isArray(char) || skew === undefined) continue;
        const [sk, dx] = typeof skew === 'number' ? [skew, 0] : skew;
        if ((char[3]?.sk || 0) === sk && (char[3]?.dx || 0) === dx) continue;
        (skews[variant] ||= {})[n] = skewed(char, skew);
      }
    }
    Font.addExtension({name: 'tex8web-skews', chars: skews});
    const dynamicSetup = Font.dynamicSetup;
    Font.dynamicSetup = function (extension, file, variants, ...rest) {
      for (const [variant, chars] of Object.entries(extension ? {} : variants)) {
        for (const [n, skew] of Object.entries(dynamicSkews[variant] ?? {})) {
          if (chars[n]) chars[n] = skewed(chars[n], skew);
        }
      }
      return dynamicSetup.call(this, extension, file, variants, ...rest);
    };

    // \mathbb: New Computer Modern's double-struck capitals, which are AMS's
    // msbm, where mathjax-modern's are of another design. The tables below
    // are from MathJax's fonts 4.1.3, and test/unit/modern-font.test.mjs
    // makes them again from node_modules.
    const doubleStruck = {
      0x1D538: [.704, 0, .722, {sk: -.014}], 0x1D539: [.685, 0, .666],
      0x2102: [.704, .019, .722, {sk: .036}], 0x1D53B: [.685, 0, .722, {sk: -.02}],
      0x1D53C: [.685, 0, .666], 0x1D53D: [.685, 0, .611, {sk: .03}],
      0x1D53E: [.704, .019, .777], 0x210D: [.685, 0, .777, {sk: .011}],
      0x1D540: [.685, 0, .388], 0x1D541: [.685, .075, .5, {sk: .055}],
      0x1D542: [.685, 0, .777, {sk: .015}], 0x1D543: [.685, 0, .666, {sk: -.148}],
      0x1D544: [.685, 0, .944, {sk: .073}], 0x2115: [.685, .019, .722, {sk: .022}],
      0x1D546: [.704, .019, .777], 0x2119: [.685, 0, .611, {sk: .028}],
      0x211A: [.704, .179, .777], 0x211D: [.685, 0, .722],
      0x1D54A: [.704, .012, .555, {sk: -.013}], 0x1D54B: [.685, 0, .666],
      0x1D54C: [.685, .019, .722, {sk: .053}], 0x1D54D: [.685, .019, .722, {sk: .072}],
      0x1D54E: [.685, .019, 1, {sk: .048}], 0x1D54F: [.685, 0, .722, {sk: .026}],
      0x1D550: [.685, 0, .722, {sk: .038}], 0x2124: [.685, 0, .666, {sk: .057}],
    };
    Font.addExtension({name: 'tex8web-newcm', fonts: ['MJX-NCM-DS'], fontURL: fontURL('newcm'),
      chars: AddFontIds({DS: {'double-struck': doubleStruck}}, 'NCM')});

    // \mathcal: the TeX font's calligraphic capitals, which are cmsy's,
    // where mathjax-modern's are of another design. mathjax-modern's
    // dynamic file of calligraphic letters, loaded when one is first used,
    // would set its letters over these.
    const calligraphic = {
      0x41: [.728, .05, .798, {ic: .021, sk: .274}], 0x42: [.705, .022, .657, {ic: .007, sk: .09}],
      0x43: [.705, .025, .527, {ic: .006, sk: .135}], 0x44: [.683, 0, .771, {sk: .06}],
      0x45: [.705, .022, .528, {ic: .036, sk: .143}], 0x46: [.683, .032, .719, {ic: .11, sk: .266}],
      0x47: [.704, .119, .595, {ic: .004, sk: .164}], 0x48: [.683, .048, .845, {sk: .163}],
      0x49: [.683, 0, .545, {ic: .097, sk: .159}], 0x4A: [.683, .119, .678, {ic: .161, sk: .219}],
      0x4B: [.705, .022, .762, {sk: .173}], 0x4C: [.705, .022, .69, {sk: .249}],
      0x4D: [.705, .05, 1.201, {sk: .128}], 0x4E: [.789, .05, .82, {ic: .159, sk: .121}],
      0x4F: [.705, .022, .796, {sk: .166}], 0x50: [.683, .057, .696, {ic: .037, sk: .099}],
      0x51: [.705, .131, .817, {sk: .124}], 0x52: [.682, .022, .848, {sk: .123}],
      0x53: [.705, .022, .606, {ic: .036, sk: .139}], 0x54: [.717, .068, .545, {ic: .288, sk: .112}],
      0x55: [.683, .028, .626, {ic: .061, sk: .06}], 0x56: [.683, .052, .613, {ic: .045, sk: .042}],
      0x57: [.683, .055, .988, {ic: .046, sk: .035}], 0x58: [.683, 0, .713, {ic: .094, sk: .121}],
      0x59: [.683, .143, .668, {ic: .046, sk: .083}], 0x5A: [.683, 0, .725, {ic: .042, sk: .033}],
    };
    const boldCalligraphic = {
      0x41: [.751, .049, .921, {ic: .068, sk: .283}], 0x42: [.705, .017, .748, {sk: .101}],
      0x43: [.703, .02, .613, {sk: .15}], 0x44: [.686, 0, .892, {sk: .045}],
      0x45: [.703, .016, .607, {ic: .02, sk: .151}], 0x46: [.686, .03, .814, {ic: .116, sk: .151}],
      0x47: [.703, .113, .682, {sk: .177}], 0x48: [.686, .048, .987, {sk: .178}],
      0x49: [.686, 0, .642, {ic: .104, sk: .199}], 0x4A: [.686, .114, .779, {ic: .158, sk: .26}],
      0x4B: [.703, .017, .871, {sk: .196}], 0x4C: [.703, .017, .788, {sk: .259}],
      0x4D: [.703, .049, 1.378, {sk: .115}], 0x4E: [.84, .049, .937, {ic: .168, sk: .139}],
      0x4F: [.703, .017, .906, {sk: .183}], 0x50: [.686, .067, .81, {ic: .036, sk: .126}],
      0x51: [.703, .146, .939, {sk: .138}], 0x52: [.686, .017, .99, {sk: .133}],
      0x53: [.703, .016, .696, {ic: .025, sk: .141}], 0x54: [.72, .069, .644, {ic: .303, sk: .144}],
      0x55: [.686, .024, .715, {ic: .056, sk: .07}], 0x56: [.686, .077, .737, {ic: .037, sk: .035}],
      0x57: [.686, .077, 1.169, {ic: .037, sk: .057}], 0x58: [.686, -.001, .817, {ic: .089, sk: .125}],
      0x59: [.686, .164, .759, {ic: .038, sk: .079}], 0x5A: [.686, 0, .818, {ic: .035, sk: .133}],
    };
    // \widehat and \widetilde: the TeX font's wide sizes, which are cmex's.
    // mathjax-modern has seven, which make a wide accent wider than in the
    // PDF, as 0.919em over ab, where TeX has 0.556em. The unsized accent is
    // mathjax-modern's ˆ or ˜, as wide as the TeX font's (internal: a
    // delimiter's c and sizes, its glyphs in the size variants).
    const wideSO = {0x2C6: [.744, -.551, .556, {ic: .008}], 0x2DC: [.722, -.597, .556]};
    const wideLO = {0x2C6: [.772, -.565, 1, {ic: .004}], 0x2DC: [.75, -.611, 1]};
    const wideS3 = {0x2C6: [.772, -.564, 1.444, {ic: .003}], 0x2DC: [.749, -.61, 1.444]};
    const wideS4 = {0x2C6: [.845, -.561, 1.889, {ic: .013}], 0x2DC: [.823, -.583, 1.889]};
    const sizes = [.5, .556, 1, 1.444, 1.889];
    const wide = (c, codes) => Object.fromEntries(codes.map(n => [n, {...Font.defaultDelimiters[n], c, sizes}]));
    // (the pieces of the bars and braces below, cmex's)
    const barPieces = {0x2223: [.627, .015, .333], 0x2225: [.627, .015, .556]};
    const bracePieces = {
      0xE150: [.12, .213, .45, {ic: .01}], 0xE151: [.12, .213, .45, {ic: .024}],
      0xE152: [.333, 0, .45, {ic: .01}], 0xE153: [.333, 0, .45, {ic: .024}],
      0xE154: [.12, 0, .4, {ic: .01}], 0xE155: [.333, 0, .9, {c: '\uE153\uE152'}],
      0xE156: [.12, .213, .9, {c: '\uE151\uE150'}],
    };
    delete Font.dynamicFiles.calligraphic;
    Font.addExtension({name: 'tex8web-tex', fontURL: fontURL('tex'),
      fonts: ['MJX-TEX-C', 'MJX-TEX-CB', 'MJX-TEX-SO', 'MJX-TEX-LO', 'MJX-TEX-S3', 'MJX-TEX-S4'],
      chars: AddFontIds({C: {'-tex-calligraphic': calligraphic}, CB: {'-tex-bold-calligraphic': boldCalligraphic},
        SO: {'-smallop': wideSO, '-size3': barPieces}, LO: {'-largeop': wideLO}, S3: {'-size3': wideS3}, S4: {'-size4': wideS4, '-size3': bracePieces}}, 'TEX'),
      delimiters: {...wide(0x2C6, [0x5E, 0x2C6, 0x302]), ...wide(0x2DC, [0x7E, 0x2DC, 0x303])}});

    // Delimiters: cmex has five sizes of ( [ { ⟨ ⌊ ⌈ and /, about 1, 1.2,
    // 1.8, 2.4, and 3em, and one of the bars, arrows, and \lgroup, which
    // TeX builds from pieces when they are taller or wider. mathjax-modern
    // has more sizes, eight of ( or two of an arrow, which make a
    // delimiter shorter or longer than in the PDF, as 1.095em around an
    // inline fraction, where TeX has 1.2em, or 1.349em for \big\uparrow,
    // where TeX has 1.2em. Each delimiter keeps the sizes nearest the TeX
    // font's, which are cmex's, and is built from pieces past them. The
    // TeX font has one size of the horizontal ones, as ‾ and ⏜, nearest
    // mathjax-modern's second (internal: a delimiter's sizes, its
    // variants, the size variants of its sizes, and schar, the characters
    // of its sizes).
    const delimiters = {};
    const keep = (codes, kept) => {
      for (const n of codes) {
        const {sizes, variants, schar} = Font.defaultDelimiters[n];
        delimiters[n] = {...Font.defaultDelimiters[n], sizes: kept.map(i => sizes[i]),
          variants: kept.map(i => variants?.[i] ?? i), ...schar && {schar: kept.map(i => schar[Math.min(i, schar.length - 1)])}};
      }
    };
    keep([0x28, 0x29, 0x5B, 0x5D, 0x7B, 0x7D, 0x2308, 0x2309, 0x230A, 0x230B, 0x2329, 0x232A, 0x27E8, 0x27E9,
      0x3008, 0x3009], [0, 2, 4, 6, 7]);
    keep([0x2F, 0x5C, 0x2215], [0, 1, 2, 3, 4]);
    keep([0x7C, 0x2016, 0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2195, 0x219E, 0x21A0, 0x21A4, 0x21A6, 0x21BC,
      0x21BD, 0x21BE, 0x21BF, 0x21C0, 0x21C1, 0x21C2, 0x21C3, 0x21D0, 0x21D1, 0x21D2, 0x21D3, 0x21D4, 0x21D5,
      0x21DA, 0x21DB, 0x2223, 0x2225, 0x2758, 0x27EE, 0x27EF, 0x27F5, 0x27F6, 0x27F7, 0x27F8, 0x27F9, 0x27FA,
      0x27FB, 0x27FC], [0]);
    keep([0xAF, 0x2C9, 0x203E, 0x20D7, 0x2312, 0x2322, 0x2323, 0x23DC, 0x23DD], [1]);
    // The bars are built from cmex's pieces, from the TeX font above.
    // mathjax-modern's pieces of ‖ are 0.057em from its sides, where
    // cmex's are 0.145em, and its pieces of | 0.113em. The piece is the
    // size variant's glyph (internal: a delimiter's stretch variants, and
    // HDW its width).
    for (const n of [0x7C, 0x2016, 0x2223, 0x2225, 0x2758]) {
      const [h, d] = delimiters[n].HDW;
      delimiters[n].HDW = [h, d, barPieces[delimiters[n].stretch[1]][2]];
    }
    // \overbrace and \underbrace: mathjax-modern's braces are thinner
    // than cmex's. They are built from cmex's pieces, from the TeX font
    // above, with the TeX font's data for the delimiter, and with
    // mathjax-modern's stretch variant that holds the pieces.
    delimiters[0x23DE] = {dir: Font.defaultDelimiters[0x23DE].dir, stretch: [0xE150, 0xE154, 0xE151, 0xE155],
      stretchv: [2, 2, 2, 2], HDW: [.333, .213, 1.844], hd: [.12, 0]};
    delimiters[0x23DF] = {dir: Font.defaultDelimiters[0x23DF].dir, stretch: [0xE152, 0xE154, 0xE153, 0xE156],
      stretchv: [2, 2, 2, 2], HDW: [.333, .213, 1.844], hd: [.12, 0]};
    delimiters[0xFE37] = delimiters[0x23DE];
    delimiters[0xFE38] = delimiters[0x23DF];
    // mathjax-modern's ‖ is 0.398em wide with its bars 0.176em apart; it
    // is drawn as its ∥, which is cmsy's ‖, 0.5em wide with them 0.235em
    // apart, as in the PDF (internal: a character's c). Text copied from a
    // page without MathML has ∥.
    Font.addExtension({name: 'tex8web-delimiters', delimiters, chars: {normal: {0x2016: [.75, .25, .5, {c: '\u2225'}]}}});

    // Dots: mathjax-modern's ellipses are as tight as in text. TeX's \ldots
    // and \cdots are three dots a thin space apart, and \vdots and \ddots
    // three dots 4pt and 3pt apart (latex.ltx). The MathML keeps the one
    // character, for speech, drawn from mathjax-modern's dot as other text
    // (internal: a character's c), which is what a reader copies from a
    // page without MathML: ". . ." or one dot. For … and ⋯, the dots are
    // set apart by six-per-em spaces: as wide as TeX's outside scripts,
    // where TeX drops the thin space. For ⋮ and ⋱, which go up, one dot is
    // drawn with two text shadows, kept in forced colors.
    Font.addExtension({name: 'tex8web-dots', chars: {normal: {
      0x2026: [.106, 0, 1.168, {c: '.\u2006.\u2006.'}],
      0x22EF: [.303, -.197, 1.168, {c: '\u22C5\u2006\u22C5\u2006\u22C5'}],
      0x22EE: [1.506, 0, .278, {c: '.'}],
      0x22F1: [1.506, 0, 1.167, {c: '.'}],
    }}});
    // (selectors other than those of the characters' own rules, which
    // would replace these)
    Object.assign(Font.defaultStyles, {
      'mjx-container mjx-c.mjx-c22EE': {'text-shadow': '0 -.4em, 0 -.8em', 'forced-color-adjust': 'none'},
      // (the top dot, 1mu in and 7pt up, then each 2mu and a dot's width
      // further, and 3pt lower)
      'mjx-container mjx-c.mjx-c22F1': {position: 'relative', left: '.056em', top: '-.7em',
        'text-shadow': '.389em .3em, .778em .6em', 'forced-color-adjust': 'none'},
    });

    // √ in text, as \textsurd in \text: mathjax-modern's √ is the radical
    // of \sqrt, which hangs below the baseline, as cmsy's \surd does. In
    // text it stands on the baseline, as the text's √ does in the PDF: its
    // box, from which MathJax places scripts and sizes rows, is raised by
    // MathJax's text node, and the glyph and its box on the page by the
    // style, as the font's data and style are shared with \sqrt and \surd
    // (internal: a text node's getVariantChar, which gives a character's
    // data).
    const raise = .76;
    const TextNode = MathJax._.output.chtml.Wrappers.TextNode.ChtmlTextNode.prototype;
    const getVariantChar = TextNode.getVariantChar;
    TextNode.getVariantChar = function (variant, n) {
      const char = getVariantChar.call(this, variant, n);
      if (n !== 0x221A || variant !== 'normal' || !this.parent.node.isKind('mtext')) return char;
      return [char[0] + raise, char[1] - raise, ...char.slice(2)];
    };
    Font.defaultStyles['mjx-mtext mjx-c.mjx-c221A'] = {'vertical-align': `${raise}em`};
  }

  const ready = startup.ready;
  startup.ready = function () {
    addTextInText();
    addHidewidth();
    sizeBigDelimiters();
    fixRowHeights();
    clearNumbers();
    matchModernFont();
    if (ready) ready(); else MathJax.startup.defaultReady();
    TEXCLASS = MathJax._.core.MmlTree.MmlNode.TEXCLASS;
    const input = MathJax.startup.document.inputJax.find(jax => jax.name === 'TeX');
    markEnvironments(input.parseOptions);
    input.postFilters.add(adjust);
  };
  return config;
}

if (typeof document !== 'undefined') {
  const data = JSON.parse(document.getElementById('tex8web-config').textContent);
  // MathJax's TeX extensions with separate fonts (bbm and co.) load the
  // fonts from jsDelivr without a version, unlike MathJax's font, so a later
  // release of them would change the page. They are pinned to MathJax's
  // version, which page.lua gives this script. The extensions set the paths
  // only if they are not set.
  const version = document.currentScript.dataset.mathjax;
  const paths = data.mathjax.loader.paths = data.mathjax.loader.paths || {};
  for (const name of ['bbm', 'bboldx', 'dsfont', 'mhchem']) {
    paths[`mathjax-${name}-extension`] = `https://cdn.jsdelivr.net/npm/@mathjax/mathjax-${name}-font-extension@${version}`;
  }
  window.MathJax = tex8web(data.mathjax, data.tex);
  // an option of ui/lazy, which prerender.mjs leaves out: the math in the
  // table of contents is typeset at once, because the bar on a phone copies
  // the entry being read. Set only on a page with a table of contents,
  // which page.lua marks: ui/lazy 4.1.3 fails on a selector that matches
  // nothing.
  if ('contents' in document.currentScript.dataset) window.MathJax.options.lazyAlwaysTypeset = '.tex8web-toc';
}
