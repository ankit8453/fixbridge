import { Router } from 'express';
import { getContext } from '../../core/context';
import { getCategoryTree } from './service';
import { listCategoriesQuerySchema } from './types';

export const router = Router();

/**
 * GET /api/v1/categories?cityId=1
 *
 * Public and unauthenticated — the taxonomy is what an app shows before anyone
 * signs in. Names are resolved through i18n, so the same rows render in hi or en.
 */
router.get('/', (req, res, next) => {
  const query = listCategoriesQuerySchema.parse(req.query);

  getCategoryTree(getContext(req), req.t, query.cityId)
    .then((tree) => {
      res.status(200).json(tree);
    })
    .catch(next);
});
