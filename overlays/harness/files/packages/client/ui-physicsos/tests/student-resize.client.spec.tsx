// @vitest-environment jsdom
import {cleanup,fireEvent,render,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {CanvasExperimentNode} from '../src/client/canvas/CanvasNodes.tsx'
import {createCanvasNodeTestProps,canvasTestDocument} from './canvas-ui-fixtures.client.ts'
vi.mock('@xyflow/react',()=>({Handle:()=>null,NodeResizer:()=>null,Position:{Left:'left',Right:'right'}}))
afterEach(cleanup)
it('offers width and height resizing with tablet dimensions and persists them',async()=>{
 const f=createCanvasNodeTestProps('experiment')
 f.commands.updateLayout.mockResolvedValue(undefined)
 const view=render(<CanvasExperimentNode {...f.props}/>)
 fireEvent.click(view.getByRole('button',{name:'Resize window'}))
 fireEvent.change(view.getByRole('spinbutton',{name:'Window width'}),{target:{value:'760'}})
 fireEvent.change(view.getByRole('spinbutton',{name:'Window height'}),{target:{value:'640'}})
 fireEvent.click(view.getByRole('button',{name:'Confirm'}))
 await waitFor(()=>expect(f.commands.updateLayout).toHaveBeenCalled())
 expect(f.commands.updateLayout.mock.calls[0]![1][0]!.layout).toMatchObject({width:760,height:640})
})
it('keeps an authentication-paused card read-only',()=>{
 const f=createCanvasNodeTestProps('experiment',{document:{...canvasTestDocument(),status:'auth-required'}})
 const view=render(<CanvasExperimentNode {...f.props}/>)
 expect((view.getByRole('button',{name:'Resize window'}) as HTMLButtonElement).disabled).toBe(true)
})
