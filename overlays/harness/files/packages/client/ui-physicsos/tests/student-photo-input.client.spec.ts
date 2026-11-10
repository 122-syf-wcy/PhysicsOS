// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { readQuestionImage } from '../src/client/question-upload.ts'
it('sends a browser photo with an empty MIME as the recognized image format', async()=>{
 const input = new File([new Uint8Array([137,80,78,71,13,10,26,10])], '题目.PNG', {type:''})
 const image = await readQuestionImage(input)
 expect(image.mediaType).toBe('image/png')
 expect(image.name).toBe('题目.PNG')
 expect(image.dataBase64).toBe('iVBORw0KGgo=')
})
