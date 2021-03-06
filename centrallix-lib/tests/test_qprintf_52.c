#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <stdlib.h>
#include "qprintf.h"
#include <assert.h>

long long
test(char** tname)
    {
    int i, rval;
    int iter;
    unsigned char buf[44];

	*tname = "qprintf-52 %STR&QUOT at end with overflow(2)";
	iter = 200000;
	for(i=0;i<iter;i++)
	    {
	    buf[39] = '\n';
	    buf[38] = '\0';
	    buf[37] = 0xff;
	    buf[36] = '\0';
	    buf[35] = '\0';
	    buf[34] = '\0';
	    buf[3] = '\n';
	    buf[2] = '\0';
	    buf[1] = 0xff;
	    buf[0] = '\0';
	    qpfPrintf(NULL, buf+4, 31, "Here is the str...: %STR&QUOT", "\"ain't\"");
	    qpfPrintf(NULL, buf+4, 31, "Here is the str...: %STR&QUOT", "\"ain't\"");
	    qpfPrintf(NULL, buf+4, 31, "Here is the str...: %STR&QUOT", "\"ain't\"");
	    rval = qpfPrintf(NULL, buf+4, 31, "Here is the str...: %STR&QUOT", "\"ain't\"");
	    assert(!strcmp(buf+4, "Here is the str...: '\\\"ain\\'t'"));
	    assert(rval == 32);
	    assert(buf[39] == '\n');
	    assert(buf[38] == '\0');
	    assert(buf[37] == 0xff);
	    assert(buf[36] == '\0');
	    assert(buf[35] == '\0');
	    assert(buf[34] == '\0');
	    assert(buf[3] == '\n');
	    assert(buf[2] == '\0');
	    assert(buf[1] == 0xff);
	    assert(buf[0] == '\0');
	    }

    return iter*4;
    }

