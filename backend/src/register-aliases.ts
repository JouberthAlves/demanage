import moduleAlias from 'module-alias';
import path from 'path';

// Em dist: este arquivo vive em dist/ → @ → dist
// Em src (tsx): vive em src/ → @ → src
moduleAlias.addAlias('@', path.join(__dirname));
