import sys,subprocess
out,files=sys.argv[1],sys.argv[2:];n=len(files)
args=[];[args.extend(['-i',f]) for f in files]
fc=''.join(f'[{i}]scale=640:360[s{i}];' for i in range(n))+''.join(f'[s{i}]' for i in range(n))+f"xstack=inputs={n}:layout="+'|'.join(f'{(i%3)*640}_{(i//3)*360}' for i in range(n))+(':fill=white' if n%3 else '')
subprocess.run(['ffmpeg','-y','-loglevel','error',*args,'-filter_complex',fc,out],check=True)
