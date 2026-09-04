const router = require('express').Router();

router.use(require('./login'));
router.use(require('./logout'));
router.use(require('./me'));
router.use(require('./register'));
router.use(require('./register-super-admin'));
router.use(require('./change-password'));
router.use(require('./forgot-password'));
router.use(require('./reset-password'));
router.use(require('./signup-status'));
router.use(require('./test'));
router.use(require('./mfa/setup'));
router.use(require('./mfa/verify'));
router.use(require('./mfa/disable'));

module.exports = router;
