import Ajv2020 from 'ajv/dist/2020.js';
import { readFile } from 'node:fs/promises';

const json = async path => JSON.parse(await readFile(path,'utf8'));
const schema = await json('schemas/visual-acceptance-v1.schema.json');
// Runtime checks validate zoned timestamps; shape validation here also compiles
// every definition/ref using the schema's declared JSON Schema 2020-12 dialect.
const ajv = new Ajv2020({strict:false,allErrors:true,validateFormats:false});
ajv.addSchema(schema);
const validators = Object.fromEntries(Object.keys(schema.$defs).map(name=>[name,ajv.compile({$ref:schema.$id+'#/$defs/'+name})]));
function validate(name,value,where) {
  if (!validators[name](value)) throw new Error(where+': '+ajv.errorsText(validators[name].errors));
}
const path=process.argv[2] || 'examples/device-hub-app/recorded-run/review.json', data=await json(path);
validate('viewModel',data,path);
let assets=0,reviews=0;
for(const cell of data.cells) {
  for(const capture of cell.captures) for(const asset of capture.assets) {validate('asset',asset,capture.id+'/'+asset.id);assets++;}
  for(const review of cell.aiReviews) {validate('aiReviewInput',review,review.id);reviews++;}
}
console.log(JSON.stringify({schemaDefinitions:Object.keys(validators).length,viewModel:path,cells:data.cells.length,assets,reviews,valid:true}));
