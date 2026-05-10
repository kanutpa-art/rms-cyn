const router = require('express').Router();
const db = require('../db/database');
const miscService = require('../services/miscService');
const contractService = require('../services/contractService');
const collectionService = require('../services/collectionService');

// GET contract preview by sign token
router.get('/:token', (req, res) => {
  const data = miscService.getContractByToken(req.params.token);
  if (!data) return res.status(410).json({ error: 'Token หมดอายุหรือถูกใช้แล้ว' });
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(data.contract.dormitory_id);
  const policy = collectionService.getPolicy(data.contract.dormitory_id);
  res.json({
    signer_type: data.token.signer_type,
    contract: data.contract,
    body: contractService.fillContract(data.contract, dorm, policy),
    signatures: miscService.getSignatures(data.contract.id)
  });
});

router.post('/:token', (req, res) => {
  try {
    const result = miscService.applySignature(req.params.token, {
      signer_name: req.body.signer_name,
      signer_line_id: req.body.signer_line_id,
      signature_data: req.body.signature_data,
      ip_address: req.ip
    });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
