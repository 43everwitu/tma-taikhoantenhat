const { Router } = require('express');
const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      adminId: req.admin.adminId,
      role: req.admin.role,
      username: req.admin.username,
      permissions: req.admin.perms,
    },
  });
});

module.exports = router;
