#include <stdio.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <time.h>
#include <sys/types.h> //for regex functions
#include <regex.h>

#ifdef HAVE_CONFIG_H
#include "config.h"
#else
#define HAVE_LIBZ 1
#endif

#include "centrallix.h"

#include "nfs/mount.h"
#include "nfs/nfs.h"
#include "nfs/mount_xdr.c"
#include "nfs/nfs_xdr.c"

/** xdr/rpc stuff **/
#include <rpc/xdr.h>
#include <rpc/rpc_msg.h>

/************************************************************************/
/* Centrallix Application Server System 				*/
/* Centrallix Core       						*/
/* 									*/
/* Copyright (C) 1998-2001 LightSys Technology Services, Inc.		*/
/* 									*/
/* This program is free software; you can redistribute it and/or modify	*/
/* it under the terms of the GNU General Public License as published by	*/
/* the Free Software Foundation; either version 2 of the License, or	*/
/* (at your option) any later version.					*/
/* 									*/
/* This program is distributed in the hope that it will be useful,	*/
/* but WITHOUT ANY WARRANTY; without even the implied warranty of	*/
/* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the	*/
/* GNU General Public License for more details.				*/
/* 									*/
/* You should have received a copy of the GNU General Public License	*/
/* along with this program; if not, write to the Free Software		*/
/* Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  		*/
/* 02111-1307  USA							*/
/*									*/
/* A copy of the GNU General Public License has been included in this	*/
/* distribution in the file "COPYING".					*/
/* 									*/
/* Module: 	net_nfs.c                 				*/
/* Author:	Jonathan Rupp, Nathan Ehresman,				*/
/*		Michael Rivera, Corey Cooper				*/
/* Creation:	February 19, 2003  					*/
/* Description:	Network handler providing an NFS interface to	 	*/
/*		Centrallix and the ObjectSystem.			*/
/************************************************************************/

/**CVSDATA***************************************************************

    $Id: net_nfs.c,v 1.2 2003/03/03 09:32:00 jorupp Exp $
    $Source: /srv/bld/centrallix-repo/centrallix/netdrivers/net_nfs.c,v $

    $Log: net_nfs.c,v $
    Revision 1.2  2003/03/03 09:32:00  jorupp
     * added some stuff to the NFS driver
       * prototypes for all NFS and mount RPC calls
       * table for mapping to those calls
       * extremely basic implimentation of 1 mount function and 1 nfs function
         * this is enough for linux mount:
    	   * connect
    	   * get a file handle for the root node
    	   * ask for attributes on that file handle
    	   * get an error while gettings those attributes
    	 * command is: mount -t nfs localhost:/ nfsroot -o port=5001,mountport=5000
     * note: the .x files aren't required, but that's the source I used for rpcgen to
     	build the basis of the .c and .h files in the nfs directory.  The header was
    	modified quite a bit though (the _xdr.c just had the header line and one function
    	changed)
     * also: some of the attribute names had to be changed (usually just added an nfs
    	the front) so they wouldn't conflict with standard C symbols (ie. stat, timeval, etc.)
     * there's still several data dumps in the code, and if you know the RFCs, you could actually
        figure out what's being sent back to the server from those....

    Revision 1.1  2003/02/23 21:56:59  jorupp
     * added configure and makefile support for net_nfs
     * added basic shell of net_nfs, including the XDR parsing of the RPC headers
       -- it will listen for requests (mount & nfs) and print out some of the decoded RPC headers


 **END-CVSDATA***********************************************************/

#define MAX_PACKET_SIZE 16384

typedef struct
    {
    XDR source_data; // needed so we can xdr_destroy() it at the end to free the memory
    struct sockaddr_in source;
    int xid;
    int procedure;
    int user;
    void *param;
    } QueueEntry, *pQueueEntry;

typedef struct
    {
    fhandle lockedFH;
    XArray waitingList;
    } ThreadInfo, *pThreadInfo;

#include "xarray.h"
#include "mtask.h"

/*** GLOBALS ***/
struct 
    {
    int numThreads;
    int queueSize;
    pQueueEntry* queue;
    int nextIn;
    int nextOut;
    pSemaphore semaphore;
    pFile nfsSocket;
    }
    NNFS;

void
dump_buffer(unsigned char* buf, int len)
    {
    int i;
    printf("Dumping %i byte buffer at %p\n",len,buf);
    if(len%4)
        printf("WARNING: %i bytes is not a multiple of 4!\n",len);
#define GOODC(c) ( (c>=' ' && c<='~') ?c:'.' )
    for(i=0;i<len;i+=4)
	{
	printf("%5i  %02x %02x %02x %02x  %c%c%c%c\n",i
	    ,(unsigned char)buf[i],(unsigned char)buf[i+1],(unsigned char)buf[i+2],(unsigned char)buf[i+3]
	    ,GOODC(buf[i]),GOODC(buf[i+1]),GOODC(buf[i+2]),GOODC(buf[i+3])
	    );
	}
    }

/** typedef for the functions that impliment the individual RPC calls **/
typedef void* (*rpc_func)(void*);

/** structure to hold the parameter info for each function **/
struct rpc_struct
    {
    rpc_func func;	/** reference to the function that impliements this procedure **/
    xdrproc_t ret;	/** the xdr_* function for the return value **/
    int ret_size;	/** the size of the return value (to be passed to nmMalloc()) **/
    xdrproc_t param;	/** the xdr_* function for the parameter **/
    int param_size;	/** the size of the parameter **/
    };

/** function prototypes for the mountd program **/
void* mountproc_null(void*);
fhstatus* mountproc_mnt(dirpath*);
mountlist* mountproc_dump(void*);
void* mountproc_umnt(dirpath*);
void* mountproc_umntall(void*);
exportlist* mountproc_export(void*);

/** the program information for mountd **/
struct rpc_struct mount_program[] = 
    {
	{
	(rpc_func)mountproc_null,
	(xdrproc_t) xdr_void, sizeof(void),
	(xdrproc_t) xdr_void, sizeof(void),
	}
    ,
	{
	(rpc_func)mountproc_mnt,
	(xdrproc_t) xdr_fhstatus, sizeof(fhstatus),
	(xdrproc_t) xdr_dirpath, sizeof(dirpath),
	}
    ,
	{
	(rpc_func)mountproc_dump,
	(xdrproc_t) xdr_mountlist, sizeof(mountlist),
	(xdrproc_t) xdr_void, sizeof(void),
	}
    ,
	{
	(rpc_func)mountproc_umnt,
	(xdrproc_t) xdr_void, sizeof(void),
	(xdrproc_t) xdr_dirpath, sizeof(dirpath),
	}
    ,
	{
	(rpc_func)mountproc_umntall,
	(xdrproc_t) xdr_void, sizeof(void),
	(xdrproc_t) xdr_void, sizeof(void),
	}
    ,
	{
	(rpc_func)mountproc_umntall,
	(xdrproc_t) xdr_exportlist, sizeof(exportlist),
	(xdrproc_t) xdr_void, sizeof(void),
	}
    };

/** the number of procedures in mount**/
int num_mount_procs = sizeof(mount_program)/sizeof(struct rpc_struct);

/** function prototypes for the nfs program **/
void* nfsproc_null(void*);
attrstat* nfsproc_getattr(fhandle*);
attrstat* nfsproc_setattr(sattrargs*);
void* nfsproc_root(void*);
diropres* nfsproc_lookup(diropargs*);
readlinkres* nfsproc_readlink(fhandle*);
readres* nfsproc_read(readargs*);
void* nfsproc_writecache(void*);
attrstat* nfsproc_write(writeargs*);
diropres* nfsproc_create(createargs*);
nfsstat* nfsproc_remove(diropargs*);
nfsstat* nfsproc_rename(renameargs*);
nfsstat* nfsproc_link(linkargs*);
nfsstat* nfsproc_symlink(symlinkargs*);
diropres* nfsproc_mkdir(createargs*);
nfsstat* nfsproc_rmdir(diropargs*);
readdirres* nfsproc_readdir(readdirargs*);
statfsres* nfsproc_statfs(fhandle*);

// :'<,'>s/\(.*\)\* \(.*\)(\(.*\)\*);/^I{^M^I(rpc_func) \2,^M^I(xdrproc_t) xdr_\1, sizeof(\1),^M^I(xdrproc_t) xdr_\3, sizeof(\3),^M^I}^M    ,
/** the program information for nfs (made with the above vim command from the function prototypes) **/
struct rpc_struct nfs_program[] = 
    {
	{
	(rpc_func) nfsproc_null,
	(xdrproc_t) xdr_void, sizeof(void),
	(xdrproc_t) xdr_void, sizeof(void),
	}
    ,
	{
	(rpc_func) nfsproc_getattr,
	(xdrproc_t) xdr_attrstat, sizeof(attrstat),
	(xdrproc_t) xdr_fhandle, sizeof(fhandle),
	}
    ,
	{
	(rpc_func) nfsproc_setattr,
	(xdrproc_t) xdr_attrstat, sizeof(attrstat),
	(xdrproc_t) xdr_sattrargs, sizeof(sattrargs),
	}
    ,
	{
	(rpc_func) nfsproc_root,
	(xdrproc_t) xdr_void, sizeof(void),
	(xdrproc_t) xdr_void, sizeof(void),
	}
    ,
	{
	(rpc_func) nfsproc_lookup,
	(xdrproc_t) xdr_diropres, sizeof(diropres),
	(xdrproc_t) xdr_diropargs, sizeof(diropargs),
	}
    ,
	{
	(rpc_func) nfsproc_readlink,
	(xdrproc_t) xdr_readlinkres, sizeof(readlinkres),
	(xdrproc_t) xdr_fhandle, sizeof(fhandle),
	}
    ,
	{
	(rpc_func) nfsproc_read,
	(xdrproc_t) xdr_readres, sizeof(readres),
	(xdrproc_t) xdr_readargs, sizeof(readargs),
	}
    ,
	{
	(rpc_func) nfsproc_writecache,
	(xdrproc_t) xdr_void, sizeof(void),
	(xdrproc_t) xdr_void, sizeof(void),
	}
    ,
	{
	(rpc_func) nfsproc_write,
	(xdrproc_t) xdr_attrstat, sizeof(attrstat),
	(xdrproc_t) xdr_writeargs, sizeof(writeargs),
	}
    ,
	{
	(rpc_func) nfsproc_create,
	(xdrproc_t) xdr_diropres, sizeof(diropres),
	(xdrproc_t) xdr_createargs, sizeof(createargs),
	}
    ,
	{
	(rpc_func) nfsproc_remove,
	(xdrproc_t) xdr_nfsstat, sizeof(nfsstat),
	(xdrproc_t) xdr_diropargs, sizeof(diropargs),
	}
    ,
	{
	(rpc_func) nfsproc_rename,
	(xdrproc_t) xdr_nfsstat, sizeof(nfsstat),
	(xdrproc_t) xdr_renameargs, sizeof(renameargs),
	}
    ,
	{
	(rpc_func) nfsproc_link,
	(xdrproc_t) xdr_nfsstat, sizeof(nfsstat),
	(xdrproc_t) xdr_linkargs, sizeof(linkargs),
	}
    ,
	{
	(rpc_func) nfsproc_symlink,
	(xdrproc_t) xdr_nfsstat, sizeof(nfsstat),
	(xdrproc_t) xdr_symlinkargs, sizeof(symlinkargs),
	}
    ,
	{
	(rpc_func) nfsproc_mkdir,
	(xdrproc_t) xdr_diropres, sizeof(diropres),
	(xdrproc_t) xdr_createargs, sizeof(createargs),
	}
    ,
	{
	(rpc_func) nfsproc_rmdir,
	(xdrproc_t) xdr_nfsstat, sizeof(nfsstat),
	(xdrproc_t) xdr_diropargs, sizeof(diropargs),
	}
    ,
	{
	(rpc_func) nfsproc_readdir,
	(xdrproc_t) xdr_readdirres, sizeof(readdirres),
	(xdrproc_t) xdr_readdirargs, sizeof(readdirargs),
	}
    ,
	{
	(rpc_func) nfsproc_statfs,
	(xdrproc_t) xdr_statfsres, sizeof(statfsres),
	(xdrproc_t) xdr_fhandle, sizeof(fhandle),
	}
    };

/** the number of procedures in nfs **/
int num_nfs_procs = sizeof(nfs_program)/sizeof(struct rpc_struct);



int
nnfs_internal_get_fhandle(fhandle fh, const dirpath path)
    {
    if(!strcmp(path,"/"))
	{
	memset(fh,0,FHSIZE);
	return 0;
	}
    return -1;
    }

int
nnfs_internal_get_path(dirpath *path, const fhandle fh)
    {
    int i;
    for(i=0;i<FHSIZE;i++)
	{
	if(fh[i]!=0)
	    return -1;
	}
    *path="/";
    return 0;
    }

//'<,'>s/\(.*\)\* \(.*\)(\(.*\));/\1\* \2(\3 param)^M    {^M    \1\* retval = NULL;^M    retval = (\1\*)nmMalloc(sizeof(\1));^M\/** do work here **\/^M    ^M    return retval;^M    }^M
/** the functions that impliement mount (made using the above vim command from the prototypes) **/
void* mountproc_null(void* param)
    {
    void* retval = NULL;
    /** do work here **/
    
    return retval;
    }

fhstatus* mountproc_mnt(dirpath* param)
    {
    int i;
    fhstatus* retval = NULL;

    retval = (fhstatus*)nmMalloc(sizeof(fhstatus));
    if(!retval)
	return NULL;
    memset(retval,0,sizeof(fhstatus));
    /** do work here **/

    printf("mount request recieved for: %s\n",*param);
    i=nnfs_internal_get_fhandle(retval->fhstatus_u.directory, *param);
    if(i==-1)
	retval->status = 1; /** this should be the UNIX error **/
    else
	retval->status = 0;
    
    return retval;
    }

mountlist* mountproc_dump(void* param)
    {
    mountlist* retval = NULL;
    retval = (mountlist*)nmMalloc(sizeof(mountlist));
    /** do work here **/
    
    return retval;
    }

void* mountproc_umnt(dirpath* param)
    {
    void* retval = NULL;
    /** do work here **/
    
    return retval;
    }

void* mountproc_umntall(void* param)
    {
    void* retval = NULL;
    /** do work here **/
    
    return retval;
    }

exportlist* mountproc_export(void* param)
    {
    exportlist* retval = NULL;
    retval = (exportlist*)nmMalloc(sizeof(exportlist));
    /** do work here **/
    
    return retval;
    }

/** the functions that impliement nfs **/
void* nfsproc_null(void* param)
    {
    void* retval = NULL;
    /** do work here **/
    
    return retval;
    }

attrstat* nfsproc_getattr(fhandle* param)
    {
    attrstat* retval = NULL;
    char *path;
    int i;
    retval = (attrstat*)nmMalloc(sizeof(attrstat));
    memset(retval,0,sizeof(attrstat));
    /** do work here **/

    i=nnfs_internal_get_path(&path, *param);
    if(i==-1)
	retval->status = 1; /** this should be the UNIX error **/
    else
	{
	retval->status = 0;
	retval->attrstat_u.attributes.type = NFDIR;
	retval->attrstat_u.attributes.mode = 0;
	retval->attrstat_u.attributes.nlink = 1;
	retval->attrstat_u.attributes.uid = 1;
	retval->attrstat_u.attributes.gid = 1;
	retval->attrstat_u.attributes.size = 0;
	retval->attrstat_u.attributes.blocksize = 0;
	retval->attrstat_u.attributes.rdev = 0;
	retval->attrstat_u.attributes.blocks = 0;
	retval->attrstat_u.attributes.fsid = 0;
	retval->attrstat_u.attributes.fileid = 0;
	retval->attrstat_u.attributes.atime.seconds = 0;
	retval->attrstat_u.attributes.atime.useconds = 0;
	retval->attrstat_u.attributes.ctime.seconds = 0;
	retval->attrstat_u.attributes.ctime.useconds = 0;
	retval->attrstat_u.attributes.mtime.seconds = 0;
	retval->attrstat_u.attributes.mtime.useconds = 0;
	}
    
    return retval;
    }

attrstat* nfsproc_setattr(sattrargs* param)
    {
    attrstat* retval = NULL;
    retval = (attrstat*)nmMalloc(sizeof(attrstat));
    /** do work here **/
    
    return retval;
    }

void* nfsproc_root(void* param)
    {
    void* retval = NULL;
    /** do work here **/
    
    return retval;
    }

diropres* nfsproc_lookup(diropargs* param)
    {
    diropres* retval = NULL;
    retval = (diropres*)nmMalloc(sizeof(diropres));
    /** do work here **/
    
    return retval;
    }

readlinkres* nfsproc_readlink(fhandle* param)
    {
    readlinkres* retval = NULL;
    retval = (readlinkres*)nmMalloc(sizeof(readlinkres));
    /** do work here **/
    
    return retval;
    }

readres* nfsproc_read(readargs* param)
    {
    readres* retval = NULL;
    retval = (readres*)nmMalloc(sizeof(readres));
    /** do work here **/
    
    return retval;
    }

void* nfsproc_writecache(void* param)
    {
    void* retval = NULL;
    /** do work here **/
    
    return retval;
    }

attrstat* nfsproc_write(writeargs* param)
    {
    attrstat* retval = NULL;
    retval = (attrstat*)nmMalloc(sizeof(attrstat));
    /** do work here **/
    
    return retval;
    }

diropres* nfsproc_create(createargs* param)
    {
    diropres* retval = NULL;
    retval = (diropres*)nmMalloc(sizeof(diropres));
    /** do work here **/
    
    return retval;
    }

nfsstat* nfsproc_remove(diropargs* param)
    {
    nfsstat* retval = NULL;
    retval = (nfsstat*)nmMalloc(sizeof(nfsstat));
    /** do work here **/
    
    return retval;
    }

nfsstat* nfsproc_rename(renameargs* param)
    {
    nfsstat* retval = NULL;
    retval = (nfsstat*)nmMalloc(sizeof(nfsstat));
    /** do work here **/
    
    return retval;
    }

nfsstat* nfsproc_link(linkargs* param)
    {
    nfsstat* retval = NULL;
    retval = (nfsstat*)nmMalloc(sizeof(nfsstat));
    /** do work here **/
    
    return retval;
    }

nfsstat* nfsproc_symlink(symlinkargs* param)
    {
    nfsstat* retval = NULL;
    retval = (nfsstat*)nmMalloc(sizeof(nfsstat));
    /** do work here **/
    
    return retval;
    }

diropres* nfsproc_mkdir(createargs* param)
    {
    diropres* retval = NULL;
    retval = (diropres*)nmMalloc(sizeof(diropres));
    /** do work here **/
    
    return retval;
    }

nfsstat* nfsproc_rmdir(diropargs* param)
    {
    nfsstat* retval = NULL;
    retval = (nfsstat*)nmMalloc(sizeof(nfsstat));
    /** do work here **/
    
    return retval;
    }

readdirres* nfsproc_readdir(readdirargs* param)
    {
    readdirres* retval = NULL;
    retval = (readdirres*)nmMalloc(sizeof(readdirres));
    /** do work here **/
    
    return retval;
    }

statfsres* nfsproc_statfs(fhandle* param)
    {
    statfsres* retval = NULL;
    retval = (statfsres*)nmMalloc(sizeof(statfsres));
    /** do work here **/

    retval->status = 1;
    
    return retval;
    }


/***
**** nnfs_internal_request_handler - waits for and processes queued nfs requests
***/
void
nnfs_internal_request_handler(void* v)
    {
    int threadNum = *(int*)v;
    char name[32];

    nmFree(v,sizeof(int));

    snprintf(name,32,"NFS-RH-#%i",threadNum);
    name[31]='\0';
    thSetName(thCurrent(),name);

    while(1)
	{
	struct rpc_msg msg_out;
	pQueueEntry entry;
	char *buf;
	XDR xdr_out;
	memset(&msg_out,0,sizeof(struct rpc_msg));

	/** block until there's a request in the queue **/
	syGetSem(NNFS.semaphore,1,0);

	printf("getting request # %i\n",NNFS.nextOut);

	/** get the request **/
	entry = NNFS.queue[NNFS.nextOut];
	NNFS.queue[NNFS.nextOut++]=NULL;
	NNFS.nextOut%=NNFS.queueSize;

	printf("entry: %p\n",entry);
	printf("xid: %x\n",entry->xid);

	/** scan the threads checking for another thread that has the object we want locked **/
	// not sure how to get the fhandle out of all the requests

	/** wait for requests to batch together **/
	//thYield();

	printf("procedure: %i\n",entry->procedure);
	msg_out.rm_xid = entry->xid;
	msg_out.rm_direction = REPLY;
	msg_out.rm_reply.rp_stat = MSG_ACCEPTED;
	msg_out.rm_reply.rp_acpt.ar_stat = SUCCESS;
	msg_out.rm_reply.rp_acpt.ar_results.where = nfs_program[entry->procedure].func(entry->param);
	msg_out.rm_reply.rp_acpt.ar_results.proc = nfs_program[entry->procedure].ret;

	buf = (char*)nmMalloc(MAX_PACKET_SIZE);
	xdrmem_create(&xdr_out,buf,MAX_PACKET_SIZE,XDR_ENCODE);
	if(!xdr_replymsg(&xdr_out,&msg_out))
	    {
	    mssError(0,"NNFS","unable to create message to send");
	    }
	else
	    {
	    int i;
	    i = xdr_getpos(&xdr_out);
	    dump_buffer(buf,i);
	    if(netSendUDP(NNFS.nfsSocket,buf,i,0,&(entry->source),NULL,0) == -1)
		{
		mssError(0,"NNFS","unable to send message: %s",strerror(errno));
		}
	    }

	xdr_destroy(&xdr_out);
	xdr_destroy(&(entry->source_data));
	nmFree(buf,MAX_PACKET_SIZE);
	nmFree(entry,sizeof(QueueEntry));
	}
    }

/*** nnfs_internal_nfs_listener - listens for and processes nfs requests
 ***   RFC 1094
 ***/
void
nnfs_internal_nfs_listener(void* v)
    {
    pStructInf my_config;
    char listen_port[32];
    char* strval;
    int intval;
    int i;
    char *buf;
    char *outbuf;
    char *remotehost;
    int remoteport;
    struct sockaddr_in remoteaddr;


	/** Set the thread's name **/
	thSetName(NULL,"NFS Listener");

	/** Get our configuration **/
	strcpy(listen_port,"5001");
	my_config = stLookup(CxGlobals.ParsedConfig, "net_nfs");
	if (my_config)
	    {
	    /** Got the config.  Now lookup what the UDP port is that we listen on **/
	    strval=NULL;
	    if (stAttrValue(stLookup(my_config, "nfs_port"), &intval, &strval, 0) >= 0)
		{
		if (strval)
		    {
		    memccpy(listen_port, strval, 0, 31);
		    listen_port[31] = '\0';
		    }
		else
		    {
		    snprintf(listen_port,32,"%d",intval);
		    }
		}
	    }

    	/** Open the server listener socket. **/
	NNFS.nfsSocket = netListenUDP(listen_port, 0);
	if (!NNFS.nfsSocket) 
	    {
	    mssErrorErrno(1,"NNFS","Could not open nfs listener");
	    thExit();
	    }
	
	buf = (char*)nmMalloc(MAX_PACKET_SIZE);
	outbuf = (char*)nmMalloc(MAX_PACKET_SIZE);
	/** Loop, accepting requests **/
	while((i=netRecvUDP(NNFS.nfsSocket,buf,MAX_PACKET_SIZE,0,&remoteaddr,&remotehost,&remoteport)) != -1)
	    {
	    XDR xdr_out; // only used on error
	    struct rpc_msg msg_in;
	    struct rpc_msg msg_out; // only used on error
	    int wasError=1; // mark if there was an error
	    int isDup=0; // mark if this is a duplicate
	    pQueueEntry entry;

	    entry = (pQueueEntry)nmMalloc(sizeof(QueueEntry));
	    if(!entry) continue;
	    memset(entry,0,sizeof(QueueEntry));
	    entry->source = remoteaddr; // copy address

	    /** process packet **/
	    printf("%i bytes recieved from: %s:%i\n",i,remotehost,remoteport);
	    xdrmem_create(&(entry->source_data),buf,i,XDR_DECODE);
	    xdrmem_create(&xdr_out,outbuf,MAX_PACKET_SIZE,XDR_ENCODE);
	    if(!xdr_callmsg(&(entry->source_data),&msg_in))
		{
		mssError(0,"NNFS","unable to retrieve message");
		xdr_destroy(&(entry->source_data));
		nmFree(entry,sizeof(QueueEntry));
		continue;
		}
	    if(msg_in.rm_direction==CALL)
		{
		int i;
		/** note: ignoring authorization for now... **/
		//printf("auth flavor: %i\n",msg_in.rm_call.cb_cred.oa_flavor);
		//printf("bytes of auth data: %u\n",msg_in.rm_call.cb_cred.oa_length);
		entry->xid = msg_out.rm_xid = msg_in.rm_xid;
		if(NNFS.nextIn < NNFS.nextOut)
		    {
		    for(i=NNFS.nextOut;i<NNFS.queueSize;i++)
			if(NNFS.queue[i]->xid == entry->xid)
			    isDup = 1;
		    for(i=0;i<NNFS.nextIn;i++)
			if(NNFS.queue[i]->xid == entry->xid)
			    isDup = 1;
		    }
		for(i=NNFS.nextOut;i<NNFS.nextIn;i++)
		    if(NNFS.queue[i]->xid == entry->xid)
			isDup = 1;
		if(isDup==0)
		    {
		    msg_out.rm_direction = REPLY;
		    if(msg_in.rm_call.cb_rpcvers == 2)
			{
			msg_out.rm_reply.rp_stat = MSG_ACCEPTED;
			if(msg_in.rm_call.cb_prog == NFS_PROGRAM)
			    {
			    if(msg_in.rm_call.cb_vers == NFS_VERSION)
				{
				if(msg_in.rm_call.cb_proc < num_nfs_procs)
				    {
				    entry->procedure = msg_in.rm_call.cb_proc;
				    entry->param = (void*)nmMalloc(nfs_program[entry->procedure].param_size);
				    memset(entry->param,0,nfs_program[entry->procedure].param_size);
				    if(nfs_program[entry->procedure].param(&(entry->source_data),(char*)entry->param))
					{
					wasError = 0;
					/** add message to the queue **/
					NNFS.queue[NNFS.nextIn++]=entry;
					NNFS.nextIn%=NNFS.queueSize;
					syPostSem(NNFS.semaphore,1,0);
					}
				    else
					{
					mssError(0,"NNFS","unable to parse parameters");
					msg_out.rm_reply.rp_acpt.ar_stat = GARBAGE_ARGS;
					nmFree(entry->param,nfs_program[entry->procedure].param_size);
					}
				    }
				else
				    {
				    mssError(0,"NNFS","Bad mountd procedure requested: %i\n",msg_in.rm_call.cb_proc);
				    msg_out.rm_reply.rp_acpt.ar_stat = PROC_UNAVAIL;
				    }
				}
			    else
				{
				mssError(0,"Invalid mount version requested: %i\n",msg_in.rm_call.cb_vers);
				msg_out.rm_reply.rp_acpt.ar_stat = PROG_MISMATCH;
				msg_out.rm_reply.rp_acpt.ar_vers.low = MOUNTVERS;
				msg_out.rm_reply.rp_acpt.ar_vers.high = MOUNTVERS;
				}
			    }
			else
			    {
			    mssError(0,"Invalid program requested: %i\n",msg_in.rm_call.cb_prog);
			    msg_out.rm_reply.rp_acpt.ar_stat = PROG_UNAVAIL;
			    }
			}
		    else
			{
			mssError(0,"Invalid RPC version requested: %i\n",msg_in.rm_call.cb_rpcvers);
			msg_out.rm_reply.rp_stat = MSG_DENIED;
			msg_out.rm_reply.rp_rjct.rj_vers.low = 2;
			msg_out.rm_reply.rp_rjct.rj_vers.high = 2;
			}
		    }
		if(wasError==1 && isDup==0)
		    {
		    if(!xdr_replymsg(&xdr_out,&msg_out))
			{
			mssError(0,"NNFS","unable to create message to send");
			}
		    else
			{
			int i;
			i=xdr_getpos(&xdr_out);
			dump_buffer(outbuf,i);
			if(netSendUDP(NNFS.nfsSocket,outbuf,i,0,&remoteaddr,NULL,0) == -1)
			    {
			    mssError(0,"NNFS","unable to send message: %s",strerror(errno));
			    }
			}
		    }
		}
	    else if(msg_in.rm_direction==REPLY)
		{
		/** it's a reply message.... -- ignore it **/
		mssError(0,"reply message recieved, but we shouldn't get one.....");
		}
	    else
		{
		mssError(0,"NNFS","invalid message direction: %i",msg_in.rm_direction);
		}
	    xdr_destroy(&xdr_out);
	    if(wasError==1 && isDup==0)
		{
		/** might not need **/
		xdr_free((xdrproc_t)&xdr_replymsg,(char*)&msg_out);
		xdr_destroy(&(entry->source_data));
		nmFree(entry,sizeof(QueueEntry));
		}
	    }
	nmFree(buf,MAX_PACKET_SIZE);
	nmFree(outbuf,MAX_PACKET_SIZE);

	/** Exit. **/
	mssError(1,"NNFS","Could not continue to accept requests.");
	netCloseTCP(NNFS.nfsSocket,0,0);

    thExit();
    }

/*** nnfs_internal_mount_listener - listens for and processes mount requests
 ***   RFC 1094
 ***/
void
nnfs_internal_mount_listener(void* v)
    {
    pFile listen_socket;
    pFile connection_socket;
    pStructInf my_config;
    char listen_port[32];
    char* strval;
    int intval;
    int i;
    char *buf;
    char *outbuf;
    char *remotehost;
    int remoteport;
    struct sockaddr_in remoteaddr;

	/** Set the thread's name **/
	thSetName(NULL,"MOUNTD Listener");

	/** Get our configuration **/
	strcpy(listen_port,"5000");
	my_config = stLookup(CxGlobals.ParsedConfig, "net_nfs");
	if (my_config)
	    {
	    /** Got the config.  Now lookup what the UDP port is that we listen on **/
	    strval=NULL;
	    if (stAttrValue(stLookup(my_config, "mount_port"), &intval, &strval, 0) >= 0)
		{
		if (strval)
		    {
		    memccpy(listen_port, strval, 0, 31);
		    listen_port[31] = '\0';
		    }
		else
		    {
		    snprintf(listen_port,32,"%d",intval);
		    }
		}
	    }

    	/** Open the server listener socket. **/
	listen_socket = netListenUDP(listen_port, 0);
	if (!listen_socket) 
	    {
	    mssErrorErrno(1,"NNFS","Could not open mount listener");
	    thExit();
	    }
	
	buf = (char*)nmMalloc(MAX_PACKET_SIZE);
	outbuf = (char*)nmMalloc(MAX_PACKET_SIZE);
	/** Loop, accepting requests **/
	while((i=netRecvUDP(listen_socket,buf,MAX_PACKET_SIZE,0,&remoteaddr,&remotehost,&remoteport)) != -1)
	    {
	    void *ret=NULL; // pointer to results returned
	    int ret_size=0; // how much memory is nmMalloc()ed at ret
	    XDR xdr_in;
	    XDR xdr_out;
	    struct rpc_msg msg_in;
	    struct rpc_msg msg_out;
	    /** process packet **/

	    printf("%i bytes recieved from: %s:%i\n",i,remotehost,remoteport);
	    xdrmem_create(&xdr_in,buf,i,XDR_DECODE);
	    xdrmem_create(&xdr_out,outbuf,MAX_PACKET_SIZE,XDR_ENCODE);
	    if(!xdr_callmsg(&xdr_in,&msg_in))
		{
		mssError(0,"NNFS","unable to retrieve message");
		xdr_destroy(&xdr_in);
		continue;
		}
	    if(msg_in.rm_direction==CALL)
		{
		/** note: ignoring authorization for now... **/
		//printf("auth flavor: %i\n",msg_in.rm_call.cb_cred.oa_flavor);
		//printf("bytes of auth data: %u\n",msg_in.rm_call.cb_cred.oa_length);
		msg_out.rm_xid = msg_in.rm_xid;
		msg_out.rm_direction = REPLY;
		if(msg_in.rm_call.cb_rpcvers == 2)
		    {
		    msg_out.rm_reply.rp_stat = MSG_ACCEPTED;
		    if(msg_in.rm_call.cb_prog == MOUNTPROG)
			{
			if(msg_in.rm_call.cb_vers == MOUNTVERS)
			    {
			    if(msg_in.rm_call.cb_proc < num_mount_procs)
				{
				int procnum = msg_in.rm_call.cb_proc;
				void *param;
				param = (void*)nmMalloc(mount_program[procnum].param_size);
				memset(param,0,mount_program[procnum].param_size);
				if(mount_program[procnum].param(&xdr_in,param))
				    {
				    ret = mount_program[procnum].func(param);
				    ret_size = mount_program[procnum].ret_size;
				    msg_out.rm_reply.rp_acpt.ar_stat = SUCCESS;
				    msg_out.rm_reply.rp_acpt.ar_results.where = ret;
				    msg_out.rm_reply.rp_acpt.ar_results.proc = mount_program[procnum].ret;
				    }
				else
				    {
				    mssError(0,"NNFS","unable to parse parameters");
				    msg_out.rm_reply.rp_acpt.ar_stat = GARBAGE_ARGS;
				    }
				nmFree(param,mount_program[procnum].param_size);
				}
			    else
				{
				mssError(0,"NNFS","Bad mountd procedure requested: %i\n",msg_in.rm_call.cb_proc);
				msg_out.rm_reply.rp_acpt.ar_stat = PROC_UNAVAIL;
				}
			    }
			else
			    {
			    mssError(0,"Invalid mount version requested: %i\n",msg_in.rm_call.cb_vers);
			    msg_out.rm_reply.rp_acpt.ar_stat = PROG_MISMATCH;
			    msg_out.rm_reply.rp_acpt.ar_vers.low = MOUNTVERS;
			    msg_out.rm_reply.rp_acpt.ar_vers.high = MOUNTVERS;
			    }
			}
		    else
			{
			mssError(0,"Invalid program requested: %i\n",msg_in.rm_call.cb_prog);
			msg_out.rm_reply.rp_acpt.ar_stat = PROG_UNAVAIL;
			}
		    }
		else
		    {
		    mssError(0,"Invalid RPC version requested: %i\n",msg_in.rm_call.cb_rpcvers);
		    msg_out.rm_reply.rp_stat = MSG_DENIED;
		    msg_out.rm_reply.rp_rjct.rj_vers.low = 2;
		    msg_out.rm_reply.rp_rjct.rj_vers.high = 2;
		    }
		if(!xdr_replymsg(&xdr_out,&msg_out))
		    {
		    mssError(0,"NNFS","unable to create message to send");
		    }
		else
		    {
		    int i;
		    i = xdr_getpos(&xdr_out);
		    dump_buffer(outbuf,i);
		    if(netSendUDP(listen_socket,outbuf,i,0,&remoteaddr,NULL,0) == -1)
			{
			mssError(0,"NNFS","unable to send message: %s",strerror(errno));
			}
		    }
		xdr_free((xdrproc_t)&xdr_replymsg,(char*)&msg_out);
		//xdr_destroy(&xdr_in);
		if(ret && ret_size>0)
		    nmFree(ret,ret_size);
		}
	    else if(msg_in.rm_direction==REPLY)
		{
		/** it's a reply message.... -- ignore it **/
		mssError(0,"reply message recieved, but we shouldn't get one.....");
		}
	    else
		{
		mssError(0,"NNFS","invalid message direction: %i",msg_in.rm_direction);
		}
	    xdr_free((xdrproc_t)xdr_callmsg,(char*)&msg_in);
	    xdr_destroy(&xdr_in);
	    xdr_destroy(&xdr_out);
	    }
	nmFree(buf,MAX_PACKET_SIZE);
	nmFree(outbuf,MAX_PACKET_SIZE);

	/** Exit. **/
	mssError(1,"NNFS","Mount listener could not continue to accept requests.");
	netCloseTCP(listen_socket,0,0);

    thExit();
    }


/*** nhtInitialize - initialize the HTTP network handler and start the 
 *** listener thread.
 ***/
int
nnfsInitialize()
    {
    pStructInf my_config;
    int i;

	mtrace();	

	/** init global object **/
	memset(&NNFS,0,sizeof(NNFS));

	my_config = stLookup(CxGlobals.ParsedConfig, "net_nfs");
	if (my_config)
	    {
	    /** Got the config.  Now lookup how many threads to use **/
	    if (stAttrValue(stLookup(my_config, "num_threads"), &(NNFS.numThreads), NULL, 0) < 0)
		{
		NNFS.numThreads = 1;
		}
	    /** Now lookup how big the queue is **/
	    if (stAttrValue(stLookup(my_config, "queue_size"), &(NNFS.queueSize), NULL, 0) < 0)
		{
		NNFS.queueSize = 100;
		}
	    }
	else
	    {
	    NNFS.numThreads = 10;
	    NNFS.queueSize = 100;
	    }

	NNFS.queue = (pQueueEntry*)nmMalloc(NNFS.queueSize*sizeof(pQueueEntry));
	memset(NNFS.queue,0,NNFS.queueSize*sizeof(pQueueEntry));
	NNFS.nextIn=0;
	NNFS.nextOut=0;
	NNFS.semaphore = syCreateSem(0,0);
	
	/** Start the mountd listener **/
	thCreate(nnfs_internal_mount_listener, 0, NULL);

	/** Start the nfs listener. **/
	thCreate(nnfs_internal_nfs_listener, 0, NULL);

	/** Start the request handler(s) **/
	for(i=0;i<NNFS.numThreads;i++)
	    {
	    int *j;
	    j=(int*)nmMalloc(sizeof(int));
	    *j=i;
	    thCreate(nnfs_internal_request_handler, 0, j);
	    }

    return 0;
    }

MODULE_INIT(nnfsInitialize);
MODULE_PREFIX("nnfs");
MODULE_DESC("NFS Network Driver");
MODULE_VERSION(0,1,0);
MODULE_IFACE(CX_CURRENT_IFACE);

